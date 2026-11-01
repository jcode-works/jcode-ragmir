import { createHash } from "node:crypto"
import {
  addLexicalDocument,
  type LexicalCorpusStatistics,
  lexicalDocument,
  lexicalDocumentScore,
} from "./lexical-scoring.js"
import { identifierParts, normalizeForMatch, shareStem, stemPrefix, tokenize } from "./text.js"
import { memoizeByText } from "./text-memo.js"
import type { EmbeddingProvider, RetrievalProfile } from "./types.js"

export interface RankingRow {
  relativePath: string
  chunkIndex: number
  searchText: string
  _distance?: number
  _score?: number
}

export interface RankedRow<Row extends RankingRow = RankingRow> {
  row: Row
  vectorScore: number
  lexicalScore: number
  combinedScore: number
  /** Source weight times definition boost applied to the fused score (1 when neutral). */
  scoreMultiplier: number
  vectorRank: number | null
  lexicalRank: number | null
  lexicalBackendScore: number | null
}

export interface RankingPolicy {
  version: 9
  embeddingProvider: EmbeddingProvider
  /** Semantic model whose calibrated evidence profile applies; null for local-hash. */
  embeddingModel: string | null
  retrievalProfile: RetrievalProfile
  maxChunksPerDocument: number
  rrfK: number
  vectorWeight: number
  lexicalWeight: number
  maximumVectorDistance: number | null
  /** Vector distance that counts as strong evidence on its own. */
  strongVectorDistance: number | null
  /** Distance required when no query word occurs in the corpus at all (gibberish, other topics). */
  vocabularyFreeDistance: number | null
  /** IDF-weighted share of query words a passage needs to count as lexical evidence; 0 = any word. */
  minimumLexicalCoverage: number
  /** Below this coverage, and without a strong vector match, a passage is flagged weakEvidence. */
  weakEvidenceCoverage: number
  /** Coverage a passage needs when only the keyword channel returned it, without vector support. */
  lexicalOnlyEvidenceCoverage: number
  /**
   * Share of the question's IDF weight on words found nowhere in the index at which its focus counts
   * as absent: only a passage within the vocabulary-free distance can then answer, none without one.
   */
  absentFocusShare: number
}

export interface QueryEvidence {
  query: string
  tokens: string[]
  anchors: string[]
}

/** Document frequency of each query word in the active index. */
export interface QueryTermStatistics {
  documentCount: number
  documentFrequencies: ReadonlyMap<string, number>
  /** Words with no exact occurrence that a fuzzy keyword query still matched, such as typos. */
  fuzzyMatchedTerms?: ReadonlySet<string>
  /**
   * Words in scripts written without spaces (Thai, Chinese, Japanese, ...): the keyword index
   * segments them differently from queries, so their frequency is not measured or weighted.
   */
  unmeasuredTerms?: ReadonlySet<string>
}

interface EvidenceProfile {
  maximumVectorDistance: number | null
  strongVectorDistance: number | null
  vocabularyFreeDistance: number | null
  minimumLexicalCoverage: number
  weakEvidenceCoverage: number
}

const RRF_K = 60
const RRF_SEMANTIC_VECTOR_WEIGHT = 1
// The local-hash vector is another lexical signal without inverse document frequency. At full RRF
// weight it lifted common-word matches above BM25 evidence on code and document corpora, so it only
// breaks ties and backfills rows that the full-text index did not return.
const RRF_LOCAL_HASH_VECTOR_WEIGHT = 0.01
const RRF_LEXICAL_WEIGHT = 1
const MIN_LEXICAL_PREFIX_LENGTH = 4
const MIN_FUZZY_TOKEN_LENGTH = 7
const MIN_TRIGRAM_DICE_SIMILARITY = 0.5
const TRANSFORMERS_MAXIMUM_VECTOR_DISTANCE = 1.1
// Calibrated on French and English golden sets plus out-of-scope and nonsense questions. e5 packs
// every text into a narrow distance band (relevant passages up to 0.36, unrelated ones from 0.26),
// so its vector channel stays permissive and weak evidence relies more on query-word coverage.
// mxbai separates them (relevant passages mostly under 1.1, unrelated ones above 1.0). These
// absolute distances are upper bounds: each index also caps them with its own noise floor.
const MODEL_EVIDENCE_PROFILES: Readonly<Record<string, EvidenceProfile>> = {
  "intfloat/multilingual-e5-small": {
    maximumVectorDistance: 0.4,
    strongVectorDistance: 0.3,
    vocabularyFreeDistance: 0.24,
    minimumLexicalCoverage: 0.3,
    weakEvidenceCoverage: 0.3,
  },
  // A coverage of 0.5 flagged a third of the correct passages of a TypeScript repository as weak:
  // natural-language questions share few words with code. 0.3 flagged 6 of 96.
  "mixedbread-ai/mxbai-embed-xsmall-v1": {
    maximumVectorDistance: TRANSFORMERS_MAXIMUM_VECTOR_DISTANCE,
    strongVectorDistance: 0.9,
    vocabularyFreeDistance: 0.85,
    minimumLexicalCoverage: 0.3,
    weakEvidenceCoverage: 0.3,
  },
}
// Uncalibrated models keep the historical rule: any related query word, or a distance up to 1.1.
// The index's noise floor then decides which of their passages count as strong evidence.
const DEFAULT_TRANSFORMERS_PROFILE: EvidenceProfile = {
  maximumVectorDistance: TRANSFORMERS_MAXIMUM_VECTOR_DISTANCE,
  strongVectorDistance: null,
  vocabularyFreeDistance: null,
  minimumLexicalCoverage: 0,
  weakEvidenceCoverage: 0.3,
}
const LOCAL_HASH_PROFILE: EvidenceProfile = {
  maximumVectorDistance: null,
  strongVectorDistance: null,
  vocabularyFreeDistance: null,
  minimumLexicalCoverage: 0,
  weakEvidenceCoverage: 0.3,
}
// With a semantic model, a passage the vector channel did not return at all has keyword support
// only. Off-topic questions share one everyday word with many documents ("height", "capital"),
// while answers on three real corpora came from the keyword channel alone in 2 of 250 questions.
// With the other 6.5 rules, requiring half of the question's IDF weight there raised refusals of
// off-topic questions on those corpora from 54 to 68 of 90, without refusing an answer.
const LEXICAL_ONLY_EVIDENCE_COVERAGE = 0.5
// A question whose most distinctive words occur nowhere in the index asks about something the corpus
// lacks ("How does it sync with Pinecone?"). Without a model nothing else can vouch for a passage,
// so local-hash refuses once absent words carry half of the question's IDF weight: on three real
// corpora, 65 of 90 off-topic and 27 of 110 near-domain questions instead of 56 and 17, with none of
// 250 answers refused, and 7 instead of 5 once an unknown word was added to each of those questions.
// Semantic models keep the vector channel's judgment and only refuse when every word is absent: a
// 40% share there refused 17 more of those 250 altered questions for 17 more unanswerable ones.
const SEMANTIC_ABSENT_FOCUS_SHARE = 1
const LOCAL_HASH_ABSENT_FOCUS_SHARE = 0.5
const IDENTIFIER_PATTERN = /[\p{L}\p{N}]+(?:[-_./][\p{L}\p{N}]+)+/gu
const WORD_JOINER_PATTERN = /[^\p{L}\p{N}]/u
const WORD_JOINERS = /[^\p{L}\p{N}]+/u
const LOW_INFORMATION_WORDS = new Set(
  (
    "a about an and are as at be been by can could describe did do does for from had has have how " +
    "i if in into is it its me my of on or our should that the their them there these they this to " +
    "us was we were what when where which who why will with would you your " +
    "au aux avec ce ces cet cette dans de des du elle elles en est et eux faire il ils je la le " +
    "les leur leurs lui ma mais me mes mon ne nos notre nous on ou par pas peux peut pour quel " +
    "quelle quelles quels qui quoi sa se ses son sont sur ta te tes toi ton tu un une vos votre vous " +
    "comment dois doit"
  ).split(" "),
)

/** Whether a folded word carries little meaning on its own ("the", "what", "de", "les"). */
export function isLowInformationWord(token: string): boolean {
  return LOW_INFORMATION_WORDS.has(token)
}

export function rankingPolicyFor(
  embeddingProvider: EmbeddingProvider,
  retrievalProfile: RetrievalProfile,
  maxChunksPerDocument: number,
  embeddingModel?: string,
): RankingPolicy {
  const semantic = embeddingProvider === "transformers"
  const profile = semantic
    ? ((embeddingModel === undefined ? undefined : MODEL_EVIDENCE_PROFILES[embeddingModel]) ??
      DEFAULT_TRANSFORMERS_PROFILE)
    : LOCAL_HASH_PROFILE
  return {
    version: 9,
    embeddingProvider,
    embeddingModel: semantic ? (embeddingModel ?? null) : null,
    retrievalProfile,
    maxChunksPerDocument,
    rrfK: RRF_K,
    vectorWeight: semantic ? RRF_SEMANTIC_VECTOR_WEIGHT : RRF_LOCAL_HASH_VECTOR_WEIGHT,
    lexicalWeight: RRF_LEXICAL_WEIGHT,
    ...profile,
    lexicalOnlyEvidenceCoverage: semantic
      ? LEXICAL_ONLY_EVIDENCE_COVERAGE
      : profile.weakEvidenceCoverage,
    absentFocusShare: semantic ? SEMANTIC_ABSENT_FOCUS_SHARE : LOCAL_HASH_ABSENT_FOCUS_SHARE,
  }
}

export function rankingPolicyFingerprint(policy: RankingPolicy): string {
  return createHash("sha256").update(JSON.stringify(policy)).digest("hex")
}

/**
 * Per-list depth at which reciprocal-rank fusion cannot lift a row that is absent from every
 * candidate list above the demand-th fused row: such a row scores at most
 * 2 / (RRF_K + depth + 1), while at least demand rows score 1 / (RRF_K + demand) or more.
 */
export function fusionCandidateDepth(demand: number): number {
  return RRF_K + 2 * demand
}

export function queryEvidence(query: string): QueryEvidence {
  const tokens = tokenize(query).filter((token) => !LOW_INFORMATION_WORDS.has(token))
  const compoundAnchors = [...query.matchAll(IDENTIFIER_PATTERN)]
    .map((match) => match[0])
    .filter((anchor) => /\d|_|\.|\//u.test(anchor))
    .map(normalizeAnchor)
  const tokenAnchors = tokens.filter(
    (token) =>
      token.length >= 4 &&
      /\d/u.test(token) &&
      (/\p{L}/u.test(token) || /^\d{4,}$/u.test(token)) &&
      !compoundAnchors.some((anchor) => anchor.includes(token)),
  )
  return {
    query,
    tokens,
    anchors: [...new Set([...compoundAnchors, ...tokenAnchors])],
  }
}

export function rankHybridRows<Row extends RankingRow>(
  query: string,
  vectorRows: Row[],
  textRows: Row[],
  policy: RankingPolicy,
  scoreMultiplierOf?: (row: Row) => number,
): Array<RankedRow<Row>> {
  const queryTokens = tokenize(query)
  const evidence = queryEvidence(query)
  const keys = new Map<Row, string>()
  const keyOf = (row: Row): string => {
    let key = keys.get(row)
    if (key === undefined) {
      key = rowKey(row)
      keys.set(row, key)
    }
    return key
  }
  const compareKeys = (left: Row, right: Row): number => compareOrdinal(keyOf(left), keyOf(right))
  const rows = mergeRows(vectorRows, textRows, keyOf)
  const exactAnchorMatches = new Map<string, number>()
  if (evidence.anchors.length > 0) {
    const requestedAnchors = new Set(evidence.anchors)
    for (const row of rows) {
      const matches = new Set<string>()
      for (const match of normalizeAnchor(row.searchText).matchAll(IDENTIFIER_PATTERN)) {
        if (requestedAnchors.has(match[0])) matches.add(match[0])
      }
      exactAnchorMatches.set(keyOf(row), matches.size)
    }
  }
  const vectorRanked = vectorRows
    .filter((row) => Number.isFinite(rowDistance(row)))
    .sort((left, right) => rowDistance(left) - rowDistance(right) || compareKeys(left, right))
  const vectorRanks = new Map<string, number>()
  vectorRanked.forEach((row, index) => {
    vectorRanks.set(keyOf(row), index)
  })

  const ftsRows = textRows.filter((row) => typeof row._score === "number")
  const lexicalRanked: Array<[string, number]> =
    ftsRows.length > 0
      ? ftsRows
          .sort(
            (left, right) => (right._score ?? 0) - (left._score ?? 0) || compareKeys(left, right),
          )
          .map((row) => [keyOf(row), row._score ?? 0])
      : [...bm25Scores(queryTokens, rows, keyOf).entries()]
          .filter(([, score]) => score > 0)
          .sort(compareScoredKeys)
  const lexicalRanks = new Map<string, number>()
  lexicalRanked.forEach(([key], index) => {
    lexicalRanks.set(key, index)
  })
  const lexicalScores = new Map(lexicalRanked)

  return rows
    .map((row) => {
      const key = keyOf(row)
      const vectorRank = vectorRanks.get(key)
      const lexicalRank = lexicalRanks.get(key)
      const vectorScore =
        vectorRank === undefined ? 0 : policy.vectorWeight / (policy.rrfK + vectorRank)
      const lexicalScore =
        lexicalRank === undefined ? 0 : policy.lexicalWeight / (policy.rrfK + lexicalRank)
      const scoreMultiplier = scoreMultiplierOf ? scoreMultiplierOf(row) : 1
      return {
        row,
        vectorScore,
        lexicalScore,
        combinedScore: (vectorScore + lexicalScore) * scoreMultiplier,
        scoreMultiplier,
        vectorRank: vectorRank === undefined ? null : vectorRank + 1,
        lexicalRank: lexicalRank === undefined ? null : lexicalRank + 1,
        lexicalBackendScore: lexicalScores.get(key) ?? null,
      }
    })
    .filter((ranked) => ranked.combinedScore > 0)
    .sort(
      (left, right) =>
        (exactAnchorMatches.get(keyOf(right.row)) ?? 0) -
          (exactAnchorMatches.get(keyOf(left.row)) ?? 0) ||
        right.combinedScore - left.combinedScore ||
        rowDistance(left.row) - rowDistance(right.row) ||
        compareKeys(left.row, right.row),
    )
}

export function candidatePassesAbstention(
  evidenceOrQuery: QueryEvidence | string,
  row: RankingRow,
  policy: RankingPolicy,
  terms: QueryTermStatistics | null = null,
  noiseFloor: number | null = null,
): boolean {
  const evidence =
    typeof evidenceOrQuery === "string" ? queryEvidence(evidenceOrQuery) : evidenceOrQuery
  return abstentionFilter(evidence, policy, terms, noiseFloor)(row)
}

/**
 * The policy's vector distances with the index's noise floor applied: the distance at which the
 * nearest passage of an off-topic probe question sits. A model packs every text into its own
 * band, and a corpus shifts it, so only a passage nearer than any off-topic question counts as
 * strong evidence, and a question with no known word needs one. The admission distance stays the
 * policy's: capping it removed correct passages from real developer questions. Local-hash vectors
 * carry no meaning and keep the policy.
 */
export function effectiveVectorDistances(
  policy: RankingPolicy,
  noiseFloor: number | null,
): Pick<
  RankingPolicy,
  "maximumVectorDistance" | "strongVectorDistance" | "vocabularyFreeDistance"
> {
  if (noiseFloor === null || policy.embeddingProvider === "local-hash") {
    return policy
  }
  const capped = (distance: number | null): number =>
    distance === null ? noiseFloor : Math.min(distance, noiseFloor)
  return {
    maximumVectorDistance: policy.maximumVectorDistance,
    strongVectorDistance: capped(policy.strongVectorDistance),
    vocabularyFreeDistance: capped(policy.vocabularyFreeDistance ?? policy.maximumVectorDistance),
  }
}

/** How many leading results must all be weak before semantic search answers nothing. */
const WEAK_ANSWER_DEPTH = 5

/**
 * Whether an answer holds no real evidence: every leading result is weak. Off-topic and
 * near-domain questions without an answer typically land here. With local-hash, whose weak flag
 * is keyword coverage alone, this refused 56 of 90 off-topic questions on three real corpora
 * instead of 12, and none of 250 answerable ones: the least covered correct answer still held 35%
 * of its question's IDF-weighted words.
 */
export function isWeakAnswer<Row>(rows: readonly Row[], isWeak: (row: Row) => boolean): boolean {
  if (rows.length === 0) {
    return false
  }
  return rows.slice(0, WEAK_ANSWER_DEPTH).every(isWeak)
}

function idfWeightOf(documentFrequency: number, documentCount: number): number {
  const frequency = Math.min(documentFrequency, documentCount)
  return Math.log(1 + (documentCount - frequency + 0.5) / (frequency + 0.5))
}

/** Inverse document frequency weight of a query word, as the coverage rules use it. */
function idfWeight(token: string, terms: QueryTermStatistics): number {
  return idfWeightOf(terms.documentFrequencies.get(token) ?? 0, terms.documentCount)
}

/**
 * Share of the IDF weight of these query words carried by words found nowhere in the index, neither
 * exactly nor through a fuzzy keyword match. A missing word weighs as if one document held it: on a
 * small index an unseen word would otherwise outweigh the rest of the question, so one unusual verb
 * ("proves") could pass for the question's focus. Words in unsegmented scripts are not measured,
 * and a query holding one never counts as absent.
 */
export function absentShareOf(tokens: readonly string[], terms: QueryTermStatistics): number {
  const unique = [...new Set(tokens)]
  if (unique.length === 0 || unique.some((token) => terms.unmeasuredTerms?.has(token))) {
    return 0
  }
  let total = 0
  let absent = 0
  for (const token of unique) {
    const documentFrequency = terms.documentFrequencies.get(token) ?? 0
    const weight = idfWeightOf(Math.max(1, documentFrequency), terms.documentCount)
    total += weight
    if (documentFrequency === 0 && !terms.fuzzyMatchedTerms?.has(token)) {
      absent += weight
    }
  }
  return total > 0 ? absent / total : 0
}

/**
 * Whether the question's focus is absent from the corpus: its words carrying `absentFocusShare` of
 * the IDF weight occur nowhere, as with nonsense, unrelated, or near-domain questions about a missing
 * feature. Only vector evidence can then support a passage.
 */
function focusAbsent(
  evidence: QueryEvidence,
  terms: QueryTermStatistics | null,
  policy: RankingPolicy,
): boolean {
  return (
    terms !== null &&
    evidence.anchors.length === 0 &&
    absentShareOf(evidence.tokens, terms) >= policy.absentFocusShare
  )
}

/**
 * Compile the abstention rule once per query. Candidates are then checked lazily in ranked order,
 * so the query tokens, prefixes, and trigrams are not rebuilt for every candidate. With term
 * statistics, calibrated models need IDF-weighted query-word coverage instead of one shared word:
 * a passage that only shares the most common word of the question is not lexical evidence.
 */
export function abstentionFilter(
  evidence: QueryEvidence,
  policy: RankingPolicy,
  terms: QueryTermStatistics | null = null,
  noiseFloor: number | null = null,
): (row: RankingRow) => boolean {
  const hasLexicalEvidence = lexicalEvidenceMatcher(evidence)
  if (evidence.anchors.length > 0) {
    return (row) => hasLexicalEvidence(row.searchText)
  }
  const noKnownWords = focusAbsent(evidence, terms, policy)
  if (policy.embeddingProvider === "local-hash") {
    return noKnownWords ? () => false : (row) => hasLexicalEvidence(row.searchText)
  }
  const distances = effectiveVectorDistances(policy, noiseFloor)
  const maximumVectorDistance = distances.maximumVectorDistance
  if (noKnownWords) {
    const required = distances.vocabularyFreeDistance ?? maximumVectorDistance
    return (row) => required !== null && rowDistance(row) <= required
  }
  const coverage =
    terms !== null && policy.minimumLexicalCoverage > 0 ? queryTermCoverage(evidence, terms) : null
  const lexical = coverage
    ? (row: RankingRow) => coverage(row.searchText) >= policy.minimumLexicalCoverage
    : (row: RankingRow) => hasLexicalEvidence(row.searchText)
  return (row) =>
    (maximumVectorDistance !== null && rowDistance(row) <= maximumVectorDistance) || lexical(row)
}

/**
 * Flag a selected passage whose support is thin: it holds a small IDF-weighted share of the query
 * words and has no strong vector match, or only the keyword channel returned it and it covers less
 * than its policy share. Search still returns it; agents should verify it first.
 */
export function weakEvidenceFilter(
  evidence: QueryEvidence,
  policy: RankingPolicy,
  terms: QueryTermStatistics | null,
  noiseFloor: number | null = null,
): (row: RankingRow) => boolean {
  if (terms === null || evidence.anchors.length > 0 || evidence.tokens.length === 0) {
    return () => false
  }
  const coverage = queryTermCoverage(evidence, terms)
  const strong = effectiveVectorDistances(policy, noiseFloor).strongVectorDistance
  return (row) => {
    const distance = rowDistance(row)
    if (strong !== null && distance <= strong) {
      return false
    }
    const required = Number.isFinite(distance)
      ? policy.weakEvidenceCoverage
      : policy.lexicalOnlyEvidenceCoverage
    return coverage(row.searchText) < required
  }
}

const coverageByTerms = new WeakMap<
  QueryTermStatistics,
  WeakMap<QueryEvidence, (text: string) => number>
>()

/**
 * IDF-weighted share of query words present in a text. Words match exactly or as one stem with a
 * short ending (`permission`, `permissions`), so a rare word weighs more than a frequent one and a
 * word missing from the corpus weighs the most. The abstention and weak-evidence filters of one
 * query share a single memoized function, so each candidate text is segmented once.
 */
export function queryTermCoverage(
  evidence: QueryEvidence,
  terms: QueryTermStatistics,
): (text: string) => number {
  let byEvidence = coverageByTerms.get(terms)
  if (!byEvidence) {
    byEvidence = new WeakMap()
    coverageByTerms.set(terms, byEvidence)
  }
  let coverage = byEvidence.get(evidence)
  if (!coverage) {
    const measure = measureQueryTermCoverage(evidence, terms)
    const known = new Map<string, number>()
    coverage = (text) => {
      let value = known.get(text)
      if (value === undefined) {
        value = measure(text)
        known.set(text, value)
      }
      return value
    }
    byEvidence.set(evidence, coverage)
  }
  return coverage
}

function measureQueryTermCoverage(
  evidence: QueryEvidence,
  terms: QueryTermStatistics,
): (text: string) => number {
  const tokens = [...new Set(evidence.tokens)].filter((token) => !terms.unmeasuredTerms?.has(token))
  const weights = tokens.map((token) => idfWeight(token, terms))
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  if (totalWeight <= 0) {
    return () => 0
  }
  // A misspelled word that the keyword search matched fuzzily covers its fuzzy relatives, as there.
  const fuzzy = tokens.map((token) => terms.fuzzyMatchedTerms?.has(token) ?? false)
  // Every word sharing a stem with a query word contains its stem prefix, so a passage whose folded
  // text holds none of them covers nothing. Unrelated candidates then skip word segmentation.
  const stemPrefixes = tokens.map(stemPrefix)
  return (text) => {
    const folded = foldedText(text)
    const present = stemPrefixes.map((prefix, index) => fuzzy[index] || folded.includes(prefix))
    if (!present.includes(true)) {
      return 0
    }
    const textTokens = coverageWords(text)
    let matched = 0
    tokens.forEach((token, index) => {
      if (!present[index]) {
        return
      }
      for (const textToken of textTokens) {
        if (
          shareStem(token, textToken) ||
          (fuzzy[index] && tokensAreFuzzyRelated(token, textToken))
        ) {
          matched += weights[index] ?? 0
          break
        }
      }
    })
    return matched / totalWeight
  }
}

const foldedText = memoizeByText(normalizeForMatch)

/**
 * The words of a passage as the keyword index splits them: word segmentation keeps JSONPath and
 * dotted identifiers (`compliance.description`) and French elisions (`l'abstention`) whole, while
 * the keyword index also matches each part.
 */
const coverageWords = memoizeByText((text: string): ReadonlySet<string> => {
  const words = new Set<string>()
  for (const word of [...tokenize(text), ...identifierParts(text)]) {
    words.add(word)
    if (WORD_JOINER_PATTERN.test(word)) {
      for (const part of word.split(WORD_JOINERS)) {
        if (part.length > 1) words.add(part)
      }
    }
  }
  return words
})

export function tokensAreLexicallyRelated(queryToken: string, textToken: string): boolean {
  if (queryToken === textToken) {
    return true
  }
  if (
    queryToken.length >= MIN_LEXICAL_PREFIX_LENGTH &&
    textToken.length >= MIN_LEXICAL_PREFIX_LENGTH &&
    sharedPrefixLength(queryToken, textToken) >= MIN_LEXICAL_PREFIX_LENGTH
  ) {
    return true
  }
  if (
    queryToken.length < MIN_FUZZY_TOKEN_LENGTH ||
    textToken.length < MIN_FUZZY_TOKEN_LENGTH ||
    Math.abs(queryToken.length - textToken.length) > 1 ||
    !/^[a-z0-9_-]+$/u.test(queryToken) ||
    !/^[a-z0-9_-]+$/u.test(textToken)
  ) {
    return false
  }
  return trigramDiceSimilarity(queryToken, textToken) >= MIN_TRIGRAM_DICE_SIMILARITY
}

function lexicalEvidenceMatcher(evidence: QueryEvidence): (text: string) => boolean {
  if (evidence.anchors.length > 0) {
    const standaloneAnchors = evidence.anchors.filter((anchor) => !/[-_./]/u.test(anchor))
    return (text) => {
      for (const match of normalizeAnchor(text).matchAll(IDENTIFIER_PATTERN)) {
        if (evidence.anchors.some((anchor) => identifiersAreRelated(anchor, match[0]))) return true
      }
      if (standaloneAnchors.length === 0) return false
      const textTokens = tokenize(text)
      return standaloneAnchors.some((anchor) => textTokens.includes(anchor))
    }
  }
  const queryTokens = new Set(evidence.tokens)
  if (queryTokens.size === 0) {
    return () => false
  }
  const prefixes = new Set(
    [...queryTokens]
      .filter((token) => token.length >= MIN_LEXICAL_PREFIX_LENGTH)
      .map((token) => token.slice(0, MIN_LEXICAL_PREFIX_LENGTH)),
  )
  const fuzzyTokens = [...queryTokens]
    .filter(isFuzzyComparable)
    .map((token) => ({ token, trigrams: tokenTrigrams(token) }))
  // Same relation as tokensAreLexicallyRelated, evaluated against precomputed query features.
  return (text) => {
    for (const textToken of tokenize(text)) {
      if (queryTokens.has(textToken)) return true
      if (
        textToken.length >= MIN_LEXICAL_PREFIX_LENGTH &&
        prefixes.has(textToken.slice(0, MIN_LEXICAL_PREFIX_LENGTH))
      ) {
        return true
      }
      if (fuzzyTokens.length === 0 || !isFuzzyComparable(textToken)) continue
      const textTrigrams = tokenTrigrams(textToken)
      for (const { token, trigrams } of fuzzyTokens) {
        if (
          Math.abs(token.length - textToken.length) <= 1 &&
          trigramSetDiceSimilarity(trigrams, textTrigrams) >= MIN_TRIGRAM_DICE_SIMILARITY
        ) {
          return true
        }
      }
    }
    return false
  }
}

/** Typo-level similarity between long words (one edit apart in length, shared trigrams). */
export function tokensAreFuzzyRelated(queryToken: string, textToken: string): boolean {
  return (
    isFuzzyComparable(queryToken) &&
    isFuzzyComparable(textToken) &&
    Math.abs(queryToken.length - textToken.length) <= 1 &&
    trigramDiceSimilarity(queryToken, textToken) >= MIN_TRIGRAM_DICE_SIMILARITY
  )
}

/**
 * Cheap necessary condition for tokensAreFuzzyRelated on a folded text: a word whose trigram Dice
 * similarity reaches s shares at least s / (2 - s) of the query word's trigrams, so a text holding
 * fewer of them has no fuzzy match and needs no word segmentation.
 */
export function fuzzyMatchPrefilter(queryToken: string): (foldedText: string) => boolean {
  if (!isFuzzyComparable(queryToken)) {
    return () => false
  }
  const trigrams = [...tokenTrigrams(queryToken)]
  const required = Math.ceil(
    (MIN_TRIGRAM_DICE_SIMILARITY * trigrams.length) / (2 - MIN_TRIGRAM_DICE_SIMILARITY) - 1e-9,
  )
  return (foldedText) => {
    let found = 0
    for (const [index, trigram] of trigrams.entries()) {
      if (foldedText.includes(trigram)) {
        found += 1
        if (found >= required) {
          return true
        }
      } else if (found + trigrams.length - index - 1 < required) {
        return false
      }
    }
    return false
  }
}

function isFuzzyComparable(token: string): boolean {
  return token.length >= MIN_FUZZY_TOKEN_LENGTH && /^[a-z0-9_-]+$/u.test(token)
}

function identifiersAreRelated(queryAnchor: string, textAnchor: string): boolean {
  if (queryAnchor === textAnchor) {
    return true
  }
  const queryParts = queryAnchor.split(/[-_./]/u)
  const textParts = textAnchor.split(/[-_./]/u)
  if (queryParts.length !== textParts.length) {
    return false
  }
  return queryParts.every((queryPart, index) => {
    const textPart = textParts[index]
    if (textPart === undefined) {
      return false
    }
    if (/^\d+$/u.test(queryPart) && /^\d+$/u.test(textPart)) {
      return queryPart === textPart
    }
    return (
      queryPart === textPart ||
      (queryPart.length >= MIN_FUZZY_TOKEN_LENGTH &&
        textPart.length >= MIN_FUZZY_TOKEN_LENGTH &&
        Math.abs(queryPart.length - textPart.length) <= 1 &&
        isSingleEditApart(queryPart, textPart))
    )
  })
}

function isSingleEditApart(left: string, right: string): boolean {
  if (left.length === right.length) {
    let differences = 0
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) {
        differences += 1
      }
    }
    return differences === 1
  }
  const [shorter, longer] = left.length < right.length ? [left, right] : [right, left]
  let shorterIndex = 0
  let longerIndex = 0
  let skipped = false
  while (shorterIndex < shorter.length && longerIndex < longer.length) {
    if (shorter[shorterIndex] === longer[longerIndex]) {
      shorterIndex += 1
      longerIndex += 1
      continue
    }
    if (skipped) {
      return false
    }
    skipped = true
    longerIndex += 1
  }
  return true
}

/** Merge both candidate lists by row key; the final ranking sort fixes the order. */
function mergeRows<Row extends RankingRow>(
  vectorRows: Row[],
  textRows: Row[],
  keyOf: (row: Row) => string,
): Row[] {
  const rows = new Map<string, Row>()
  for (const row of textRows) {
    rows.set(keyOf(row), row)
  }
  for (const row of vectorRows) {
    const key = keyOf(row)
    const existing = rows.get(key)
    if (!existing) {
      rows.set(key, row)
      continue
    }
    const merged = { ...existing, ...row }
    if (existing._score !== undefined) {
      merged._score = existing._score
    }
    rows.set(key, merged)
  }
  return [...rows.values()]
}

function bm25Scores<Row extends RankingRow>(
  queryTokens: string[],
  rows: Row[],
  keyOf: (row: Row) => string,
): Map<string, number> {
  const scores = new Map<string, number>()
  if (queryTokens.length === 0 || rows.length === 0) {
    return scores
  }
  const uniqueQueryTokens = [...new Set(queryTokens)]
  const documents = rows.map((row) => ({ row, document: lexicalDocument(row.searchText) }))
  const statistics: LexicalCorpusStatistics = {
    documentCount: 0,
    totalLength: 0,
    documentFrequencies: new Map(),
  }
  for (const { document } of documents) addLexicalDocument(statistics, document, uniqueQueryTokens)
  for (const { row, document } of documents) {
    const score = lexicalDocumentScore(document, statistics, uniqueQueryTokens)
    if (score > 0) {
      scores.set(keyOf(row), score)
    }
  }
  return scores
}

function compareScoredKeys(left: [string, number], right: [string, number]): number {
  return right[1] - left[1] || compareOrdinal(left[0], right[0])
}

/** Locale-independent tie-break, so equal scores rank the same on every machine. */
function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function rowDistance(row: RankingRow): number {
  return typeof row._distance === "number" && row._distance >= 0
    ? row._distance
    : Number.POSITIVE_INFINITY
}

function rowKey(row: RankingRow): string {
  return `${row.relativePath}\0${String(row.chunkIndex).padStart(12, "0")}`
}

function normalizeAnchor(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
}

function trigramDiceSimilarity(left: string, right: string): number {
  return trigramSetDiceSimilarity(tokenTrigrams(left), tokenTrigrams(right))
}

function trigramSetDiceSimilarity(left: Set<string>, right: Set<string>): number {
  let shared = 0
  for (const trigram of left) {
    if (right.has(trigram)) {
      shared += 1
    }
  }
  return (2 * shared) / (left.size + right.size)
}

function tokenTrigrams(token: string): Set<string> {
  return new Set(
    Array.from({ length: token.length - 2 }, (_value, index) => token.slice(index, index + 3)),
  )
}

function sharedPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length)
  let index = 0
  while (index < limit && left[index] === right[index]) {
    index += 1
  }
  return index
}

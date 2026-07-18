import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { loadConfig } from "./config.js"
import { doctorWithConfig } from "./doctor.js"
import { indexPolicyFingerprint } from "./index-policy.js"
import { knowledgeBaseIdentity } from "./knowledge-bases.js"
import { summarizeIndexedCorpus } from "./quality-report.js"
import { readIndexManifestFilePage, readIndexManifestHeader } from "./store.js"
import { VERSION } from "./version.js"

const TEAM_SNAPSHOT_SCHEMA_VERSION = 1
const TEAM_SNAPSHOT_PAGE_SIZE = 1_000
const MAX_TEAM_SNAPSHOT_BYTES = 64 * 1024 * 1024
const MAX_TEAM_LABEL_CHARACTERS = 80
const MAX_TEAM_PATH_CHARACTERS = 4_096
const SHA256_PATTERN = /^[0-9a-f]{64}$/u

const teamSnapshotFileSchema = z
  .object({
    relativePath: z
      .string()
      .min(1)
      .max(MAX_TEAM_PATH_CHARACTERS)
      .refine(isTeamRelativePath, "must be a normalized relative source path"),
    checksum: z.string().regex(SHA256_PATTERN),
    chunkCount: z.number().int().nonnegative(),
  })
  .strict()

const teamSourceContractSchema = z
  .string()
  .min(1)
  .max(MAX_TEAM_PATH_CHARACTERS)
  .refine(isTeamSourceContract, "must not expose an absolute or parent-relative source path")

const teamSnapshotSchema = z
  .object({
    schemaVersion: z.literal(TEAM_SNAPSHOT_SCHEMA_VERSION),
    createdAt: z.iso.datetime(),
    label: z.string().min(1).max(MAX_TEAM_LABEL_CHARACTERS),
    knowledgeBaseId: z.string().min(1).max(256).nullable(),
    runtimeRagmirVersion: z.string().min(1).max(128),
    ready: z.boolean(),
    freshnessWarning: z.string().max(8_192).nullable(),
    configuration: z
      .object({
        sources: z.array(teamSourceContractSchema),
        privacyProfile: z.enum(["strict", "private", "trusted", "custom"]),
        retrievalProfile: z.enum(["fast", "balanced", "quality", "custom"]),
        embeddingProvider: z.enum(["local-hash", "transformers"]),
        embeddingModel: z.string().max(1_024),
        embeddingModelRevision: z.string().max(1_024),
        embeddingModelDigest: z.string().max(1_024).nullable(),
        redactionEnabled: z.boolean(),
        chunkSize: z.number().int().positive(),
        chunkOverlap: z.number().int().nonnegative(),
        sourceFingerprintMode: z.enum(["fast", "strict"]),
        incrementalFailurePolicy: z.enum(["preserve-last-good", "remove-stale"]),
        retrievalTopK: z.number().int().positive(),
        indexPolicyFingerprint: z.string().regex(SHA256_PATTERN),
      })
      .strict(),
    corpus: z
      .object({
        fingerprint: z.string().regex(SHA256_PATTERN).nullable(),
        activeIndexFingerprint: z.string().regex(SHA256_PATTERN).nullable(),
        indexedWithRagmirVersion: z.string().min(1).max(128).nullable(),
        indexSchemaVersion: z.number().int().nonnegative().nullable(),
        indexedFiles: z.number().int().nonnegative(),
        chunksIndexed: z.number().int().nonnegative(),
        files: z.array(teamSnapshotFileSchema),
      })
      .strict(),
    health: z
      .object({
        missingFromIndex: z.number().int().nonnegative(),
        staleInIndex: z.number().int().nonnegative(),
        emptyTextFiles: z.number().int().nonnegative(),
        oversizedFiles: z.number().int().nonnegative(),
        securityWarnings: z.number().int().nonnegative(),
      })
      .strict(),
    notice: z.string().max(1_024),
  })
  .strict()

export type TeamSnapshot = z.infer<typeof teamSnapshotSchema>
export type TeamSnapshotFile = z.infer<typeof teamSnapshotFileSchema>

export type TeamComparisonStatus =
  | "synchronized"
  | "not-ready"
  | "configuration-mismatch"
  | "corpus-mismatch"

export interface TeamConfigurationDifference {
  field: string
  scope: "runtime" | "source-contract" | "index" | "retrieval" | "privacy"
  local: string | number | boolean | null | string[]
  peer: string | number | boolean | null | string[]
  requiresRebuild: boolean
}

export interface TeamChangedFile {
  relativePath: string
  localChecksum: string
  peerChecksum: string
  localChunks: number
  peerChunks: number
}

export interface TeamComparison {
  status: TeamComparisonStatus
  synchronized: boolean
  summary: string
  localLabel: string
  peerLabel: string
  sameConfiguration: boolean
  sameCorpus: boolean
  authorityDecisionRequired: boolean
  configurationDifferences: TeamConfigurationDifference[]
  files: {
    localOnly: string[]
    peerOnly: string[]
    changed: TeamChangedFile[]
  }
  recommendedActions: string[]
}

export interface CreateTeamSnapshotOptions {
  cwd?: string
  label?: string
}

interface ExternalSourceMapping {
  alias: string
  rootPath: string
  exactFile: boolean
}

interface SnapshotSourceContract {
  sources: string[]
  externalMappings: ExternalSourceMapping[]
}

export async function createTeamSnapshot(
  options: CreateTeamSnapshotOptions = {},
): Promise<TeamSnapshot> {
  const config = await loadConfig(options.cwd ?? process.cwd())
  const sourceContract = await createSnapshotSourceContract(config.projectRoot, config.sources)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const manifestBefore = await readIndexManifestHeader(config)
    const report = await doctorWithConfig(config)
    const files = manifestBefore
      ? await readAllManifestFiles(
          config,
          manifestBefore.fileCount,
          sourceContract.externalMappings,
        )
      : []
    const manifestAfter = await readIndexManifestHeader(config)
    if (
      !sameManifestGeneration(manifestBefore, manifestAfter) ||
      report.corpusFingerprint !== (manifestAfter?.corpusFingerprint ?? null) ||
      report.indexedFiles !== (manifestAfter?.fileCount ?? 0) ||
      report.chunksIndexed !== (manifestAfter?.chunkCount ?? 0)
    ) {
      continue
    }
    const identity = knowledgeBaseIdentity(config.projectRoot)
    const snapshot: TeamSnapshot = {
      schemaVersion: TEAM_SNAPSHOT_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      label: normalizeTeamLabel(options.label ?? "local"),
      knowledgeBaseId: identity?.id ?? null,
      runtimeRagmirVersion: VERSION,
      ready: report.ready,
      freshnessWarning: report.indexFreshness.warning,
      configuration: {
        sources: sourceContract.sources,
        privacyProfile: config.privacyProfile,
        retrievalProfile: config.retrievalProfile,
        embeddingProvider: config.embeddingProvider,
        embeddingModel: config.embeddingModel,
        embeddingModelRevision: config.embeddingModelRevision,
        embeddingModelDigest: config.embeddingModelDigest,
        redactionEnabled: config.redaction.enabled,
        chunkSize: config.chunkSize,
        chunkOverlap: config.chunkOverlap,
        sourceFingerprintMode: config.sourceFingerprintMode,
        incrementalFailurePolicy: config.incrementalFailurePolicy,
        retrievalTopK: config.topK,
        indexPolicyFingerprint: indexPolicyFingerprint(config),
      },
      corpus: {
        fingerprint: manifestAfter ? fingerprintTeamFiles(files) : null,
        activeIndexFingerprint: manifestAfter?.corpusFingerprint ?? null,
        indexedWithRagmirVersion: manifestAfter?.ragmirVersion ?? null,
        indexSchemaVersion: manifestAfter?.schemaVersion ?? null,
        indexedFiles: manifestAfter?.fileCount ?? 0,
        chunksIndexed: manifestAfter?.chunkCount ?? 0,
        files,
      },
      health: {
        missingFromIndex: report.missingFromIndex,
        staleInIndex: report.staleInIndex,
        emptyTextFiles: report.emptyTextFiles,
        oversizedFiles: report.oversizedFiles,
        securityWarnings: report.securityWarnings.length,
      },
      notice:
        "This snapshot contains relative source paths and SHA-256 checksums, never source text or absolute project paths. Share it only with authorized team members.",
    }
    assertTeamSnapshotIntegrity(snapshot)
    return snapshot
  }
  throw new Error("The active index changed repeatedly while creating the team snapshot. Retry.")
}

export async function writeTeamSnapshot(
  snapshot: TeamSnapshot,
  outputPath: string,
): Promise<string> {
  const validated = teamSnapshotSchema.parse(snapshot)
  assertTeamSnapshotIntegrity(validated)
  const resolved = path.resolve(outputPath)
  await mkdir(path.dirname(resolved), { recursive: true })
  const temporaryPath = `${resolved}.${randomUUID()}.tmp`
  const serialized = `${JSON.stringify(validated, null, 2)}\n`
  if (Buffer.byteLength(serialized, "utf8") > MAX_TEAM_SNAPSHOT_BYTES) {
    throw new Error(`Team snapshot exceeds the ${MAX_TEAM_SNAPSHOT_BYTES}-byte safety limit.`)
  }
  try {
    await writeFile(temporaryPath, serialized, { encoding: "utf8", mode: 0o600 })
    await rename(temporaryPath, resolved)
  } finally {
    await rm(temporaryPath, { force: true })
  }
  return resolved
}

export async function readTeamSnapshot(snapshotPath: string): Promise<TeamSnapshot> {
  const resolved = path.resolve(snapshotPath)
  const metadata = await stat(resolved)
  if (!metadata.isFile()) {
    throw new Error(`Team snapshot is not a file: ${resolved}`)
  }
  if (metadata.size > MAX_TEAM_SNAPSHOT_BYTES) {
    throw new Error(
      `Team snapshot exceeds the ${MAX_TEAM_SNAPSHOT_BYTES}-byte safety limit: ${resolved}`,
    )
  }

  let raw: unknown
  try {
    raw = JSON.parse(await readFile(resolved, "utf8"))
  } catch (error) {
    throw new Error(`Team snapshot is not valid JSON: ${resolved}`, { cause: error })
  }
  const result = teamSnapshotSchema.safeParse(raw)
  if (!result.success) {
    throw new Error(
      `Team snapshot does not match schema v${TEAM_SNAPSHOT_SCHEMA_VERSION}: ${resolved}`,
    )
  }
  assertTeamSnapshotIntegrity(result.data)
  return result.data
}

export function compareTeamSnapshots(local: TeamSnapshot, peer: TeamSnapshot): TeamComparison {
  const validatedLocal = teamSnapshotSchema.parse(local)
  const validatedPeer = teamSnapshotSchema.parse(peer)
  assertTeamSnapshotIntegrity(validatedLocal)
  assertTeamSnapshotIntegrity(validatedPeer)
  const configurationDifferences = compareConfiguration(validatedLocal, validatedPeer)
  const localFiles = new Map(
    validatedLocal.corpus.files.map((file) => [file.relativePath, file] as const),
  )
  const peerFiles = new Map(
    validatedPeer.corpus.files.map((file) => [file.relativePath, file] as const),
  )
  const localOnly = [...localFiles.keys()].filter((file) => !peerFiles.has(file)).sort()
  const peerOnly = [...peerFiles.keys()].filter((file) => !localFiles.has(file)).sort()
  const changed = [...localFiles.entries()]
    .flatMap(([relativePath, localFile]) => {
      const peerFile = peerFiles.get(relativePath)
      if (!peerFile || peerFile.checksum === localFile.checksum) {
        return []
      }
      return [
        {
          relativePath,
          localChecksum: localFile.checksum,
          peerChecksum: peerFile.checksum,
          localChunks: localFile.chunkCount,
          peerChunks: peerFile.chunkCount,
        },
      ]
    })
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  const sameConfiguration = configurationDifferences.length === 0
  const sameCorpus =
    validatedLocal.corpus.fingerprint !== null &&
    validatedLocal.corpus.fingerprint === validatedPeer.corpus.fingerprint &&
    localOnly.length === 0 &&
    peerOnly.length === 0 &&
    changed.length === 0
  const synchronized =
    validatedLocal.ready && validatedPeer.ready && sameConfiguration && sameCorpus
  const status = comparisonStatus(validatedLocal, validatedPeer, sameConfiguration, sameCorpus)

  return {
    status,
    synchronized,
    summary: comparisonSummary(status, localOnly.length, peerOnly.length, changed.length),
    localLabel: validatedLocal.label,
    peerLabel: validatedPeer.label,
    sameConfiguration,
    sameCorpus,
    authorityDecisionRequired:
      !sameCorpus && localOnly.length + peerOnly.length + changed.length > 0,
    configurationDifferences,
    files: { localOnly, peerOnly, changed },
    recommendedActions: recommendedActions(
      validatedLocal,
      validatedPeer,
      configurationDifferences,
      sameCorpus,
    ),
  }
}

function sameManifestGeneration(
  before: Awaited<ReturnType<typeof readIndexManifestHeader>>,
  after: Awaited<ReturnType<typeof readIndexManifestHeader>>,
): boolean {
  if (!before || !after) {
    return before === after
  }
  return (
    before.createdAt === after.createdAt &&
    before.tableName === after.tableName &&
    before.schemaVersion === after.schemaVersion &&
    before.fileCount === after.fileCount &&
    before.chunkCount === after.chunkCount &&
    before.corpusFingerprint === after.corpusFingerprint
  )
}

function isTeamRelativePath(value: string): boolean {
  if (value.includes("\0") || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    return false
  }
  return !value.split(/[\\/]/u).some((segment) => segment === "..")
}

function isTeamSourceContract(value: string): boolean {
  const source = value.startsWith("!") ? value.slice(1) : value
  return source.length > 0 && isTeamRelativePath(source)
}

function assertTeamSnapshotIntegrity(snapshot: TeamSnapshot): void {
  if (snapshot.corpus.indexedFiles !== snapshot.corpus.files.length) {
    throw new Error("Team snapshot indexedFiles does not match its file inventory.")
  }
  const chunks = snapshot.corpus.files.reduce((total, file) => total + file.chunkCount, 0)
  if (chunks !== snapshot.corpus.chunksIndexed) {
    throw new Error("Team snapshot chunksIndexed does not match its file inventory.")
  }
  const paths = snapshot.corpus.files.map((file) => file.relativePath)
  if (new Set(paths).size !== paths.length) {
    throw new Error("Team snapshot contains duplicate relative paths.")
  }
  if (snapshot.corpus.fingerprint !== null) {
    const calculated = fingerprintTeamFiles(snapshot.corpus.files)
    if (snapshot.corpus.fingerprint !== calculated) {
      throw new Error("Team snapshot corpus fingerprint does not match its file inventory.")
    }
  }
  if (
    snapshot.ready &&
    (snapshot.corpus.fingerprint === null ||
      snapshot.freshnessWarning !== null ||
      snapshot.health.missingFromIndex > 0 ||
      snapshot.health.staleInIndex > 0 ||
      snapshot.health.emptyTextFiles > 0 ||
      snapshot.health.oversizedFiles > 0 ||
      snapshot.health.securityWarnings > 0)
  ) {
    throw new Error("Team snapshot cannot be ready while freshness, coverage, or security fails.")
  }
}

function fingerprintTeamFiles(files: TeamSnapshotFile[]): string {
  return summarizeIndexedCorpus(
    [...files].sort((left, right) =>
      compareUnicodeScalarValues(left.relativePath, right.relativePath),
    ),
  ).corpusFingerprint
}

async function readAllManifestFiles(
  config: Awaited<ReturnType<typeof loadConfig>>,
  expectedFiles: number,
  externalMappings: ExternalSourceMapping[],
): Promise<TeamSnapshotFile[]> {
  const files: TeamSnapshotFile[] = []
  let offset = 0
  while (offset < expectedFiles) {
    const page = await readIndexManifestFilePage(config, offset, TEAM_SNAPSHOT_PAGE_SIZE)
    if (!page) {
      throw new Error("The active index file inventory changed while creating the team snapshot.")
    }
    files.push(
      ...page.files.map((file) => ({
        relativePath: snapshotManifestPath(
          config.projectRoot,
          file.relativePath,
          file.checksum,
          externalMappings,
        ),
        checksum: file.checksum,
        chunkCount: file.chunkCount,
      })),
    )
    if (page.nextOffset === null) {
      break
    }
    offset = page.nextOffset
  }
  if (files.length !== expectedFiles) {
    throw new Error("The active index file inventory is incomplete. Retry the team snapshot.")
  }
  return files.sort((left, right) =>
    compareUnicodeScalarValues(left.relativePath, right.relativePath),
  )
}

async function createSnapshotSourceContract(
  projectRoot: string,
  sources: string[],
): Promise<SnapshotSourceContract> {
  const externalMappings: ExternalSourceMapping[] = []
  const snapshotSources = await Promise.all(
    sources.map(async (entry, index) => {
      const excluded = entry.startsWith("!")
      const source = excluded ? entry.slice(1) : entry
      const firstGlobCharacter = source.search(/[[\]*?{}()+@]/u)
      const literalPrefix = firstGlobCharacter === -1 ? source : source.slice(0, firstGlobCharacter)
      const globSuffix = firstGlobCharacter === -1 ? "" : source.slice(firstGlobCharacter)
      const prefixWithoutTrailingSeparators = literalPrefix.replace(/[\\/]+$/u, "")
      const resolvedPrefix = path.resolve(projectRoot, prefixWithoutTrailingSeparators || ".")
      const outsideProject = isOutsideProject(projectRoot, resolvedPrefix)
      if (!outsideProject) {
        const normalizedSource = path.isAbsolute(source)
          ? joinSnapshotPath(path.relative(projectRoot, resolvedPrefix), globSuffix)
          : normalizeSnapshotPath(source)
        return excluded ? `!${normalizedSource}` : normalizedSource
      }

      const alias = `<external-source-${index + 1}>`
      if (!excluded) {
        const metadata =
          firstGlobCharacter === -1 ? await stat(resolvedPrefix).catch(() => null) : null
        externalMappings.push({
          alias,
          rootPath: resolvedPrefix,
          exactFile: metadata?.isFile() ?? false,
        })
      }
      const sanitized = joinSnapshotPath(alias, normalizeSnapshotPath(globSuffix))
      return excluded ? `!${sanitized}` : sanitized
    }),
  )
  return {
    sources: snapshotSources,
    externalMappings: externalMappings.sort(
      (left, right) => right.rootPath.length - left.rootPath.length,
    ),
  }
}

function snapshotManifestPath(
  projectRoot: string,
  relativePath: string,
  checksum: string,
  externalMappings: ExternalSourceMapping[],
): string {
  const absolutePath = path.resolve(projectRoot, relativePath)
  if (!isOutsideProject(projectRoot, absolutePath)) {
    return normalizeSnapshotPath(path.relative(projectRoot, absolutePath))
  }
  for (const mapping of externalMappings) {
    if (mapping.exactFile && absolutePath === mapping.rootPath) {
      return joinSnapshotPath(mapping.alias, path.basename(absolutePath))
    }
    if (!mapping.exactFile && !isOutsideProject(mapping.rootPath, absolutePath)) {
      return joinSnapshotPath(mapping.alias, path.relative(mapping.rootPath, absolutePath))
    }
  }
  const basename = path.basename(absolutePath) || "source"
  const pathDigest = createHash("sha256").update(relativePath).digest("hex").slice(0, 12)
  return joinSnapshotPath(
    "<external-unmapped>",
    `${checksum.slice(0, 12)}-${pathDigest}-${basename}`,
  )
}

function isOutsideProject(projectRoot: string, candidatePath: string): boolean {
  const relative = path.relative(projectRoot, candidatePath)
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
}

function joinSnapshotPath(prefix: string, suffix: string): string {
  const normalizedPrefix = normalizeSnapshotPath(prefix).replace(/\/$/u, "")
  const normalizedSuffix = normalizeSnapshotPath(suffix).replace(/^\/+|\/+$/gu, "")
  if (normalizedPrefix.length === 0) {
    return normalizedSuffix
  }
  return normalizedSuffix.length > 0 ? `${normalizedPrefix}/${normalizedSuffix}` : normalizedPrefix
}

function normalizeSnapshotPath(value: string): string {
  return value.replaceAll("\\", "/")
}

function compareUnicodeScalarValues(left: string, right: string): number {
  let leftIndex = 0
  let rightIndex = 0
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftCodePoint = left.codePointAt(leftIndex)
    const rightCodePoint = right.codePointAt(rightIndex)
    if (leftCodePoint === undefined || rightCodePoint === undefined) {
      break
    }
    if (leftCodePoint !== rightCodePoint) {
      return leftCodePoint - rightCodePoint
    }
    leftIndex += leftCodePoint > 0xffff ? 2 : 1
    rightIndex += rightCodePoint > 0xffff ? 2 : 1
  }
  return left.length - right.length
}

function normalizeTeamLabel(label: string): string {
  const normalized = label.trim()
  if (normalized.length === 0 || normalized.length > MAX_TEAM_LABEL_CHARACTERS) {
    throw new Error(`Team label must contain 1 to ${MAX_TEAM_LABEL_CHARACTERS} characters.`)
  }
  return normalized
}

function compareConfiguration(
  local: TeamSnapshot,
  peer: TeamSnapshot,
): TeamConfigurationDifference[] {
  const differences: TeamConfigurationDifference[] = []
  addDifference(
    differences,
    "runtimeRagmirVersion",
    "runtime",
    local.runtimeRagmirVersion,
    peer.runtimeRagmirVersion,
  )
  addDifference(
    differences,
    "sources",
    "source-contract",
    local.configuration.sources,
    peer.configuration.sources,
  )
  addDifference(
    differences,
    "privacyProfile",
    "privacy",
    local.configuration.privacyProfile,
    peer.configuration.privacyProfile,
    true,
  )
  addDifference(
    differences,
    "retrievalProfile",
    "retrieval",
    local.configuration.retrievalProfile,
    peer.configuration.retrievalProfile,
  )
  addDifference(
    differences,
    "embeddingProvider",
    "index",
    local.configuration.embeddingProvider,
    peer.configuration.embeddingProvider,
    true,
  )
  addDifference(
    differences,
    "embeddingModel",
    "index",
    local.configuration.embeddingModel,
    peer.configuration.embeddingModel,
    true,
  )
  addDifference(
    differences,
    "embeddingModelRevision",
    "index",
    local.configuration.embeddingModelRevision,
    peer.configuration.embeddingModelRevision,
    true,
  )
  addDifference(
    differences,
    "embeddingModelDigest",
    "index",
    local.configuration.embeddingModelDigest,
    peer.configuration.embeddingModelDigest,
    true,
  )
  addDifference(
    differences,
    "redactionEnabled",
    "privacy",
    local.configuration.redactionEnabled,
    peer.configuration.redactionEnabled,
    true,
  )
  addDifference(
    differences,
    "chunkSize",
    "index",
    local.configuration.chunkSize,
    peer.configuration.chunkSize,
    true,
  )
  addDifference(
    differences,
    "chunkOverlap",
    "index",
    local.configuration.chunkOverlap,
    peer.configuration.chunkOverlap,
    true,
  )
  addDifference(
    differences,
    "sourceFingerprintMode",
    "index",
    local.configuration.sourceFingerprintMode,
    peer.configuration.sourceFingerprintMode,
    true,
  )
  addDifference(
    differences,
    "incrementalFailurePolicy",
    "index",
    local.configuration.incrementalFailurePolicy,
    peer.configuration.incrementalFailurePolicy,
  )
  addDifference(
    differences,
    "retrievalTopK",
    "retrieval",
    local.configuration.retrievalTopK,
    peer.configuration.retrievalTopK,
  )
  addDifference(
    differences,
    "indexPolicyFingerprint",
    "index",
    local.configuration.indexPolicyFingerprint,
    peer.configuration.indexPolicyFingerprint,
    true,
  )
  return differences
}

function addDifference(
  differences: TeamConfigurationDifference[],
  field: string,
  scope: TeamConfigurationDifference["scope"],
  local: TeamConfigurationDifference["local"],
  peer: TeamConfigurationDifference["peer"],
  requiresRebuild = false,
): void {
  if (JSON.stringify(local) !== JSON.stringify(peer)) {
    differences.push({ field, scope, local, peer, requiresRebuild })
  }
}

function comparisonStatus(
  local: TeamSnapshot,
  peer: TeamSnapshot,
  sameConfiguration: boolean,
  sameCorpus: boolean,
): TeamComparisonStatus {
  if (!local.ready || !peer.ready) {
    return "not-ready"
  }
  if (!sameConfiguration) {
    return "configuration-mismatch"
  }
  return sameCorpus ? "synchronized" : "corpus-mismatch"
}

function comparisonSummary(
  status: TeamComparisonStatus,
  localOnly: number,
  peerOnly: number,
  changed: number,
): string {
  if (status === "synchronized") {
    return "Both ready indexes use the same configuration and indexed source bytes."
  }
  if (status === "not-ready") {
    return "At least one index is not ready. Repair readiness before deciding whether corpora match."
  }
  if (status === "configuration-mismatch") {
    return "Team configuration differs. Align it before comparing retrieval behavior."
  }
  return `Indexed source bytes differ: ${localOnly} local-only, ${peerOnly} peer-only, ${changed} changed.`
}

function recommendedActions(
  local: TeamSnapshot,
  peer: TeamSnapshot,
  configurationDifferences: TeamConfigurationDifference[],
  sameCorpus: boolean,
): string[] {
  const actions: string[] = []
  if (!local.ready) {
    actions.push(`On ${local.label}, run \`rgr doctor --fix\` and \`rgr audit\` until ready=true.`)
  }
  if (!peer.ready) {
    actions.push(`On ${peer.label}, run \`rgr doctor --fix\` and \`rgr audit\` until ready=true.`)
  }
  if (configurationDifferences.some((difference) => difference.scope === "runtime")) {
    actions.push("Run `rgr upgrade` on both environments so they use the same Ragmir version.")
  }
  if (configurationDifferences.length > 0) {
    actions.push(
      `Align the reported configuration fields (${configurationDifferences.map((difference) => difference.field).join(", ")}).`,
    )
    if (configurationDifferences.some((difference) => difference.requiresRebuild)) {
      actions.push("After alignment, run `rgr upgrade` on each affected environment.")
    } else {
      actions.push("After alignment, run `rgr ingest` on each affected environment.")
    }
  }
  if (!sameCorpus) {
    actions.push(
      "Confirm that the shared source folder finished synchronizing, then use the declared Git, Drive, or team revision as the authority. Ragmir never guesses which copy is correct.",
    )
    actions.push("Run `rgr ingest` after source synchronization.")
  }
  if (actions.length > 0) {
    actions.push("Export a fresh snapshot and compare again until status=synchronized.")
  }
  return actions
}

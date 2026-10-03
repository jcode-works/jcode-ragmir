import type { RankedRow, RankingRow } from "./ranking.js"

interface DiversifiableRow extends RankingRow {
  text: string
  charStart?: number
  charEnd?: number
}

export interface DocumentDiversityOptions<Row extends DiversifiableRow> {
  topK: number
  maxChunksPerDocument: number
  isExactPathMatch?: (row: Row) => boolean
  /**
   * Relevance gate evaluated lazily in ranked order. Rows that fail it are excluded exactly as if
   * the input had been filtered first, but most candidates below the selected rows are never tested.
   */
  isRelevant?: (row: Row) => boolean
}

export interface DocumentDiversityResult<Row extends DiversifiableRow> {
  rows: Array<RankedRow<Row>>
  backfillActivated: boolean
}

export function selectDiverseRows<Row extends DiversifiableRow>(
  rows: Array<RankedRow<Row>>,
  options: DocumentDiversityOptions<Row>,
): DocumentDiversityResult<Row> {
  const uniqueRowAt = uniqueRelevantRows(rows, options.isRelevant, options.isExactPathMatch)
  const selected: Array<RankedRow<Row>> = []
  const selectedKeys = new Set<string>()
  const perDocument = new Map<string, number>()

  const appendRow = (
    row: RankedRow<Row>,
    enforceDocumentCap: boolean,
    allowOverlap: boolean,
  ): boolean => {
    const key = rowKey(row.row)
    if (selectedKeys.has(key)) {
      return false
    }
    if (
      !allowOverlap &&
      selected.some((candidate) => overlapsDocumentSpan(candidate.row, row.row))
    ) {
      return false
    }
    const documentCount = perDocument.get(row.row.relativePath) ?? 0
    if (enforceDocumentCap && documentCount >= options.maxChunksPerDocument) {
      return false
    }
    selected.push(row)
    selectedKeys.add(key)
    perDocument.set(row.row.relativePath, documentCount + 1)
    return true
  }

  for (let index = 0, row = uniqueRowAt(index); row; index += 1, row = uniqueRowAt(index)) {
    appendRow(row, true, false)
    if (selected.length >= options.topK) {
      return { rows: selected, backfillActivated: false }
    }
  }

  let backfillActivated = false
  for (let index = 0, row = uniqueRowAt(index); row; index += 1, row = uniqueRowAt(index)) {
    if (appendRow(row, false, false)) {
      backfillActivated = true
    }
    if (selected.length >= options.topK) {
      return { rows: selected, backfillActivated }
    }
  }

  for (let index = 0, row = uniqueRowAt(index); row; index += 1, row = uniqueRowAt(index)) {
    if (appendRow(row, false, true)) {
      backfillActivated = true
    }
    if (selected.length >= options.topK) {
      break
    }
  }

  return { rows: selected, backfillActivated }
}

/**
 * Lazily yield relevant rows with duplicate texts collapsed. Each text keeps the position of its
 * first relevant row and the representative an eager pass would choose: an exact path match, then
 * the most canonical path, with earlier rows winning ties.
 */
function uniqueRelevantRows<Row extends DiversifiableRow>(
  rows: Array<RankedRow<Row>>,
  isRelevant: ((row: Row) => boolean) | undefined,
  isExactPathMatch: ((row: Row) => boolean) | undefined,
): (index: number) => RankedRow<Row> | undefined {
  const textKeys = rows.map((ranked) => ranked.row.text.replace(/\s+/gu, " ").trim().toLowerCase())
  const rowsByText = new Map<string, number[]>()
  textKeys.forEach((textKey, index) => {
    const group = rowsByText.get(textKey)
    if (group) {
      group.push(index)
    } else {
      rowsByText.set(textKey, [index])
    }
  })
  const relevance: Array<boolean | undefined> = []
  const relevant = (index: number): boolean => {
    const known = relevance[index]
    if (known !== undefined) {
      return known
    }
    const ranked = rows[index]
    const result = ranked !== undefined && (isRelevant?.(ranked.row) ?? true)
    relevance[index] = result
    return result
  }
  const isExact = (row: Row): boolean => isExactPathMatch?.(row) ?? false
  const representative = (group: number[], firstIndex: number): RankedRow<Row> | undefined => {
    let chosen = rows[firstIndex]
    for (const index of group) {
      const candidate = rows[index]
      if (index <= firstIndex || !candidate || !chosen || !relevant(index)) {
        continue
      }
      const candidateIsExact = isExact(candidate.row)
      if (
        candidateIsExact !== isExact(chosen.row)
          ? candidateIsExact
          : preferCanonicalPath(candidate.row.relativePath, chosen.row.relativePath)
      ) {
        chosen = candidate
      }
    }
    return chosen
  }
  const consumedTexts = new Set<string>()
  const uniqueRows: Array<RankedRow<Row>> = []
  let cursor = 0
  return (index) => {
    while (uniqueRows.length <= index && cursor < rows.length) {
      const rowIndex = cursor
      cursor += 1
      const textKey = textKeys[rowIndex]
      if (textKey === undefined || consumedTexts.has(textKey) || !relevant(rowIndex)) {
        continue
      }
      consumedTexts.add(textKey)
      const chosen = representative(rowsByText.get(textKey) ?? [rowIndex], rowIndex)
      if (chosen) {
        uniqueRows.push(chosen)
      }
    }
    return uniqueRows[index]
  }
}

function overlapsDocumentSpan(left: DiversifiableRow, right: DiversifiableRow): boolean {
  if (left.relativePath !== right.relativePath) {
    return false
  }
  if (
    typeof left.charStart !== "number" ||
    typeof left.charEnd !== "number" ||
    typeof right.charStart !== "number" ||
    typeof right.charEnd !== "number"
  ) {
    return false
  }
  return left.charStart < right.charEnd && right.charStart < left.charEnd
}

function preferCanonicalPath(candidate: string, current: string): boolean {
  const candidateDepth = candidate.split("/").length
  const currentDepth = current.split("/").length
  return (
    candidateDepth < currentDepth ||
    (candidateDepth === currentDepth && candidate.length < current.length)
  )
}

function rowKey(row: RankingRow): string {
  return `${row.relativePath}\0${row.chunkIndex}`
}

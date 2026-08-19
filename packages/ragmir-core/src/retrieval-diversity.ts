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
}

export interface DocumentDiversityResult<Row extends DiversifiableRow> {
  rows: Array<RankedRow<Row>>
  backfillActivated: boolean
}

export function selectDiverseRows<Row extends DiversifiableRow>(
  rows: Array<RankedRow<Row>>,
  options: DocumentDiversityOptions<Row>,
): DocumentDiversityResult<Row> {
  const uniqueRows = deduplicateText(rows, options.isExactPathMatch)
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

  for (const row of uniqueRows) {
    appendRow(row, true, false)
    if (selected.length >= options.topK) {
      return { rows: selected, backfillActivated: false }
    }
  }

  let backfillActivated = false
  for (const row of uniqueRows) {
    if (appendRow(row, false, false)) {
      backfillActivated = true
    }
    if (selected.length >= options.topK) {
      return { rows: selected, backfillActivated }
    }
  }

  for (const row of uniqueRows) {
    if (appendRow(row, false, true)) {
      backfillActivated = true
    }
    if (selected.length >= options.topK) {
      break
    }
  }

  return { rows: selected, backfillActivated }
}

function deduplicateText<Row extends DiversifiableRow>(
  rows: Array<RankedRow<Row>>,
  isExactPathMatch: ((row: Row) => boolean) | undefined,
): Array<RankedRow<Row>> {
  const uniqueRows: Array<RankedRow<Row>> = []
  const textIndexes = new Map<string, number>()

  for (const row of rows) {
    const textKey = row.row.text.replace(/\s+/gu, " ").trim().toLowerCase()
    const existingIndex = textIndexes.get(textKey)
    if (existingIndex === undefined) {
      textIndexes.set(textKey, uniqueRows.length)
      uniqueRows.push(row)
      continue
    }
    const existing = uniqueRows[existingIndex]
    if (!existing) {
      continue
    }
    const existingIsExact = isExactPathMatch?.(existing.row) ?? false
    const candidateIsExact = isExactPathMatch?.(row.row) ?? false
    if (
      candidateIsExact !== existingIsExact
        ? candidateIsExact
        : preferCanonicalPath(row.row.relativePath, existing.row.relativePath)
    ) {
      uniqueRows[existingIndex] = row
    }
  }

  return uniqueRows
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

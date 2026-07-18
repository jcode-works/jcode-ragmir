import type { SourceLocationKind } from "./types.js"

export interface CitationCoordinates {
  relativePath: string
  chunkIndex: number
  lineStart?: number
  lineEnd?: number
  pageStart?: number
  pageEnd?: number
  locationKind?: SourceLocationKind
  locationStart?: number
  locationEnd?: number
  locationLabel?: string
  cellStart?: string
  cellEnd?: string
}

export function citationForCoordinates(coordinates: CitationCoordinates): string {
  const location = locationSegment(coordinates)
  const lines = lineSegment(coordinates.lineStart, coordinates.lineEnd)
  return `${coordinates.relativePath}${location}${lines}#${coordinates.chunkIndex}`
}

export function stripCitationCoordinates(value: string): string {
  return value
    .replace(/:L\d+-L\d+$/u, "")
    .replace(/:cells=[A-Z]+\d+(?:-[A-Z]+\d+)?$/u, "")
    .replace(/:sheet=[^:]+$/u, "")
    .replace(/:(?:p\d+(?:-p\d+)?|slide\d+(?:-slide\d+)?|spine\d+(?:-spine\d+)?)$/u, "")
}

function locationSegment(coordinates: CitationCoordinates): string {
  const pageStart = positiveInteger(coordinates.pageStart)
  const pageEnd = positiveInteger(coordinates.pageEnd)
  if (pageStart !== null) {
    return `:p${pageStart}${pageEnd !== null && pageEnd !== pageStart ? `-p${pageEnd}` : ""}`
  }

  const start = positiveInteger(coordinates.locationStart)
  const end = positiveInteger(coordinates.locationEnd)
  if (coordinates.locationKind === "slide" && start !== null) {
    return `:slide${start}${end !== null && end !== start ? `-slide${end}` : ""}`
  }
  if (coordinates.locationKind === "epub" && start !== null) {
    return `:spine${start}${end !== null && end !== start ? `-spine${end}` : ""}`
  }
  if (coordinates.locationKind === "sheet") {
    const label = coordinates.locationLabel?.trim()
    const sheet = label
      ? `:sheet=${encodeURIComponent(label)}`
      : start === null
        ? ""
        : `:sheet=${start}`
    const cellStart = validCell(coordinates.cellStart)
    const cellEnd = validCell(coordinates.cellEnd)
    const cells =
      cellStart === null
        ? ""
        : `:cells=${cellStart}${cellEnd !== null && cellEnd !== cellStart ? `-${cellEnd}` : ""}`
    return `${sheet}${cells}`
  }
  return ""
}

function lineSegment(lineStart: number | undefined, lineEnd: number | undefined): string {
  const start = positiveInteger(lineStart)
  const end = positiveInteger(lineEnd)
  return start === null || end === null ? "" : `:L${start}-L${end}`
}

function positiveInteger(value: number | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null
}

function validCell(value: string | undefined): string | null {
  return value && /^[A-Z]+\d+$/u.test(value) ? value : null
}

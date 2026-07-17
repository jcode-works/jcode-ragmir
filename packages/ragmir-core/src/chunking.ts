import { createHash } from "node:crypto"
import { markdownFenceSpans, structuralSpans } from "./document-structure.js"
import type { ParsedDocument, TextChunk } from "./types.js"

const PARAGRAPH_BREAK_MIN_RATIO = 0.45
const SENTENCE_BREAK_MIN_RATIO = 0.55
const LINE_BREAK_MIN_RATIO = 0.65
const WHITESPACE_BREAK_MIN_RATIO = 0.75
const SENTENCE_BOUNDARIES = [". ", "? ", "! ", "。", "？", "！"]

export interface ChunkDocumentOptions {
  maxChunks?: number
}

export function chunkDocument(
  document: ParsedDocument,
  chunkSize: number,
  chunkOverlap: number,
  options: ChunkDocumentOptions = {},
): TextChunk[] {
  if (!document.text) {
    return []
  }

  const chunks: TextChunk[] = []
  const lineStarts = lineStartOffsets(document.text)
  const sourceRegions = document.regions?.map((region) => ({
    charStart: region.charStart,
    charEnd: region.charEnd,
    contextPath: region.contextPath,
  }))
  const structured =
    sourceRegions && sourceRegions.length > 0
      ? sourceRegions
      : structuralSpans(document.text, document.file.extension, chunkSize)
  const regions =
    structured.length > 0
      ? structured
      : [
          {
            charStart: 0,
            charEnd: document.text.length,
            contextPath: "",
            kind: "markdown-section" as const,
          },
        ]
  const fences = [".md", ".mdx", ".markdown"].includes(document.file.extension)
    ? markdownFenceSpans(document.text)
    : []
  let chunkIndex = 0

  for (const region of regions) {
    let cursor = region.charStart
    while (cursor < region.charEnd) {
      const end = chooseChunkEnd(document.text, cursor, chunkSize, region.charEnd, fences)
      const span = trimmedSpan(document.text, cursor, end)

      if (span.text) {
        if (options.maxChunks !== undefined && chunks.length >= options.maxChunks) {
          throw new Error(
            `Chunk limit of ${options.maxChunks} exceeded for ${document.file.relativePath}. Increase chunkSize or split the source file.`,
          )
        }
        const id = createHash("sha256")
          .update(`${document.file.relativePath}:${chunkIndex}:${region.contextPath}:${span.text}`)
          .digest("hex")
        const lineCoordinates =
          document.sourceLineCoordinates === false
            ? {}
            : {
                lineStart: lineNumberForOffset(lineStarts, span.start),
                lineEnd: lineNumberForOffset(lineStarts, Math.max(span.start, span.end - 1)),
              }
        chunks.push({
          id,
          source: document.file.source,
          relativePath: document.file.relativePath,
          chunkIndex,
          contextPath: region.contextPath,
          text: span.text,
          charStart: span.start,
          charEnd: span.end,
          ...lineCoordinates,
          ...pageRangeForSpan(document, span.start, span.end),
          ...sourceLocationForSpan(document, span.start, span.end),
          checksum: document.file.checksum,
          bytes: document.file.bytes,
          mtimeMs: document.file.mtimeMs,
        })
        chunkIndex += 1
      }

      if (end >= region.charEnd) {
        break
      }
      cursor = fences.some((fence) => fence.start === end)
        ? end
        : Math.max(end - chunkOverlap, cursor + 1, region.charStart)
    }
  }

  return chunks
}

function sourceLocationForSpan(
  document: ParsedDocument,
  start: number,
  end: number,
): Pick<
  TextChunk,
  "locationKind" | "locationStart" | "locationEnd" | "locationLabel" | "cellStart" | "cellEnd"
> {
  const region = document.regions?.find(
    (candidate) => candidate.charStart < end && candidate.charEnd > start,
  )
  if (!region) {
    return {}
  }
  return {
    locationKind: region.location.kind,
    locationStart: region.location.start,
    locationEnd: region.location.end,
    ...(region.location.label ? { locationLabel: region.location.label } : {}),
    ...(region.location.cellStart ? { cellStart: region.location.cellStart } : {}),
    ...(region.location.cellEnd ? { cellEnd: region.location.cellEnd } : {}),
  }
}

export function chunkSearchText(chunk: Pick<TextChunk, "contextPath" | "text">): string {
  return chunk.contextPath ? `${chunk.contextPath}\n${chunk.text}` : chunk.text
}

function pageRangeForSpan(
  document: ParsedDocument,
  start: number,
  end: number,
): { pageStart?: number; pageEnd?: number } {
  if (!document.pages || document.pages.length === 0) {
    return {}
  }
  const overlapping = document.pages.filter((page) => page.charStart < end && page.charEnd > start)
  const first = overlapping[0]
  const last = overlapping.at(-1)
  return first && last ? { pageStart: first.pageNumber, pageEnd: last.pageNumber } : {}
}

function chooseChunkEnd(
  text: string,
  cursor: number,
  chunkSize: number,
  regionEnd: number,
  fences: Array<{ start: number; end: number }>,
): number {
  const hardEnd = Math.min(cursor + chunkSize, regionEnd)
  if (hardEnd === regionEnd) {
    return hardEnd
  }

  const intersectedFence = fences.find(
    (fence) => fence.start < hardEnd && fence.end > hardEnd && fence.end <= regionEnd,
  )
  if (intersectedFence && intersectedFence.end - intersectedFence.start <= chunkSize) {
    return intersectedFence.start > cursor ? intersectedFence.start : intersectedFence.end
  }

  const window = text.slice(cursor, hardEnd)
  const paragraphBreak = window.lastIndexOf("\n\n")
  if (paragraphBreak > chunkSize * PARAGRAPH_BREAK_MIN_RATIO) {
    return cursor + paragraphBreak
  }

  const sentenceBreakEnd = lastSentenceBreakEnd(window)
  if (sentenceBreakEnd > chunkSize * SENTENCE_BREAK_MIN_RATIO) {
    return cursor + sentenceBreakEnd
  }

  const lineBreak = window.lastIndexOf("\n")
  if (lineBreak > chunkSize * LINE_BREAK_MIN_RATIO) {
    return cursor + lineBreak
  }

  const whitespace = window.lastIndexOf(" ")
  if (whitespace > chunkSize * WHITESPACE_BREAK_MIN_RATIO) {
    return cursor + whitespace
  }

  return hardEnd
}

function lastSentenceBreakEnd(text: string): number {
  let end = -1
  for (const boundary of SENTENCE_BOUNDARIES) {
    const index = text.lastIndexOf(boundary)
    if (index >= 0) {
      end = Math.max(end, index + (boundary.endsWith(" ") ? boundary.length - 1 : boundary.length))
    }
  }
  return end
}

interface TextSpan {
  start: number
  end: number
  text: string
}

function trimmedSpan(text: string, start: number, end: number): TextSpan {
  let trimmedStart = start
  let trimmedEnd = end
  while (trimmedStart < trimmedEnd && /\s/u.test(text[trimmedStart] ?? "")) {
    trimmedStart += 1
  }
  while (trimmedEnd > trimmedStart && /\s/u.test(text[trimmedEnd - 1] ?? "")) {
    trimmedEnd -= 1
  }
  return {
    start: trimmedStart,
    end: trimmedEnd,
    text: text.slice(trimmedStart, trimmedEnd),
  }
}

function lineStartOffsets(text: string): number[] {
  const starts = [0]
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n" && index + 1 < text.length) {
      starts.push(index + 1)
    }
  }
  return starts
}

function lineNumberForOffset(lineStarts: number[], offset: number): number {
  let low = 0
  let high = lineStarts.length - 1
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const lineStart = lineStarts[mid] ?? 0
    if (lineStart <= offset) {
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return Math.max(1, high + 1)
}

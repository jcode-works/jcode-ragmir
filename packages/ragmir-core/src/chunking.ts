import { createHash } from "node:crypto"
import type { ParsedDocument, TextChunk } from "./types.js"

const PARAGRAPH_BREAK_MIN_RATIO = 0.45
const SENTENCE_BREAK_MIN_RATIO = 0.55
const WHITESPACE_BREAK_MIN_RATIO = 0.75

export function chunkDocument(
  document: ParsedDocument,
  chunkSize: number,
  chunkOverlap: number,
): TextChunk[] {
  if (!document.text) {
    return []
  }

  const chunks: TextChunk[] = []
  const lineStarts = lineStartOffsets(document.text)
  let cursor = 0
  let chunkIndex = 0

  while (cursor < document.text.length) {
    const end = chooseChunkEnd(document.text, cursor, chunkSize)
    const span = trimmedSpan(document.text, cursor, end)

    if (span.text) {
      const id = createHash("sha256")
        .update(`${document.file.relativePath}:${chunkIndex}:${span.text}`)
        .digest("hex")
      chunks.push({
        id,
        source: document.file.source,
        relativePath: document.file.relativePath,
        chunkIndex,
        text: span.text,
        charStart: span.start,
        charEnd: span.end,
        lineStart: lineNumberForOffset(lineStarts, span.start),
        lineEnd: lineNumberForOffset(lineStarts, Math.max(span.start, span.end - 1)),
        checksum: document.file.checksum,
        bytes: document.file.bytes,
        mtimeMs: document.file.mtimeMs,
      })
      chunkIndex += 1
    }

    if (end >= document.text.length) {
      break
    }
    cursor = Math.max(end - chunkOverlap, cursor + 1)
  }

  return chunks
}

function chooseChunkEnd(text: string, cursor: number, chunkSize: number): number {
  const hardEnd = Math.min(cursor + chunkSize, text.length)
  if (hardEnd === text.length) {
    return hardEnd
  }

  const window = text.slice(cursor, hardEnd)
  const paragraphBreak = window.lastIndexOf("\n\n")
  if (paragraphBreak > chunkSize * PARAGRAPH_BREAK_MIN_RATIO) {
    return cursor + paragraphBreak
  }

  const sentenceBreak = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("? "),
    window.lastIndexOf("! "),
  )
  if (sentenceBreak > chunkSize * SENTENCE_BREAK_MIN_RATIO) {
    return cursor + sentenceBreak + 1
  }

  const whitespace = window.lastIndexOf(" ")
  if (whitespace > chunkSize * WHITESPACE_BREAK_MIN_RATIO) {
    return cursor + whitespace
  }

  return hardEnd
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

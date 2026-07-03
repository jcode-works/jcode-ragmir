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
  let cursor = 0
  let chunkIndex = 0

  while (cursor < document.text.length) {
    const end = chooseChunkEnd(document.text, cursor, chunkSize)
    const text = document.text.slice(cursor, end).trim()

    if (text) {
      const id = createHash("sha256")
        .update(`${document.file.relativePath}:${chunkIndex}:${text}`)
        .digest("hex")
      chunks.push({
        id,
        source: document.file.source,
        relativePath: document.file.relativePath,
        chunkIndex,
        text,
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

import { createHash, randomUUID } from "node:crypto"
import { open as openFile, readFile, rename, rm, stat } from "node:fs/promises"
import path from "node:path"
import { isRecord } from "./guards.js"
import { MAX_EXTERNAL_TEXT_STDIO_BYTES } from "./limits.js"
import { ensurePrivateDirectory, hardenPrivateFile } from "./permissions.js"

const OCR_CACHE_SCHEMA_VERSION = 1
const MAX_OCR_CACHE_RECORD_BYTES = MAX_EXTERNAL_TEXT_STDIO_BYTES + 64 * 1_024
export const PDF_OCR_PARSER_POLICY = "pdf-text-v2+ocr-cache-v1"

export interface PdfOcrCacheIdentity {
  sourceChecksum: string
  page: number
  engine: string
  engineVersion: string
  language: string
  dpi: number
  parserPolicy: string
  commandFingerprint: string
}

interface PdfOcrCacheRecord extends PdfOcrCacheIdentity {
  schemaVersion: typeof OCR_CACHE_SCHEMA_VERSION
  cacheKey: string
  text: string
}

export function pdfOcrCacheKey(identity: PdfOcrCacheIdentity): string {
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex")
}

export async function readPdfOcrCache(
  projectRoot: string,
  identity: PdfOcrCacheIdentity,
): Promise<string | null> {
  const cacheKey = pdfOcrCacheKey(identity)
  try {
    const cachePath = pdfOcrCachePath(projectRoot, cacheKey)
    const metadata = await stat(cachePath)
    if (metadata.size > MAX_OCR_CACHE_RECORD_BYTES) {
      return null
    }
    const value: unknown = JSON.parse(await readFile(cachePath, "utf8"))
    return isPdfOcrCacheRecord(value, cacheKey, identity) ? value.text : null
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null
    }
    if (error instanceof SyntaxError) {
      return null
    }
    throw error
  }
}

export async function writePdfOcrCache(
  projectRoot: string,
  identity: PdfOcrCacheIdentity,
  text: string,
): Promise<void> {
  if (Buffer.byteLength(text, "utf8") > MAX_EXTERNAL_TEXT_STDIO_BYTES) {
    throw new Error("OCR cache entry exceeds the external text output limit.")
  }
  const cacheKey = pdfOcrCacheKey(identity)
  const targetPath = pdfOcrCachePath(projectRoot, cacheKey)
  const directory = path.dirname(targetPath)
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`
  const record: PdfOcrCacheRecord = {
    schemaVersion: OCR_CACHE_SCHEMA_VERSION,
    cacheKey,
    ...identity,
    text,
  }
  const serialized = `${JSON.stringify(record)}\n`
  if (Buffer.byteLength(serialized, "utf8") > MAX_OCR_CACHE_RECORD_BYTES) {
    return
  }

  await ensurePrivateDirectory(directory)
  try {
    const handle = await openFile(temporaryPath, "wx", 0o600)
    try {
      await handle.writeFile(serialized, "utf8")
      await handle.sync()
    } finally {
      await handle.close()
    }
    await hardenPrivateFile(temporaryPath)
    await rename(temporaryPath, targetPath)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

function pdfOcrCachePath(projectRoot: string, cacheKey: string): string {
  return path.join(projectRoot, ".ragmir", "ocr-cache", cacheKey.slice(0, 2), `${cacheKey}.json`)
}

function isPdfOcrCacheRecord(
  value: unknown,
  cacheKey: string,
  identity: PdfOcrCacheIdentity,
): value is PdfOcrCacheRecord {
  return (
    isRecord(value) &&
    value.schemaVersion === OCR_CACHE_SCHEMA_VERSION &&
    value.cacheKey === cacheKey &&
    value.sourceChecksum === identity.sourceChecksum &&
    value.page === identity.page &&
    value.engine === identity.engine &&
    value.engineVersion === identity.engineVersion &&
    value.language === identity.language &&
    value.dpi === identity.dpi &&
    value.parserPolicy === identity.parserPolicy &&
    value.commandFingerprint === identity.commandFingerprint &&
    typeof value.text === "string" &&
    Buffer.byteLength(value.text, "utf8") <= MAX_EXTERNAL_TEXT_STDIO_BYTES
  )
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

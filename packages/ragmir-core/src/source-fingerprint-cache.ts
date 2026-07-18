import { randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { open as openFile, rename, rm } from "node:fs/promises"
import path from "node:path"
import { isRecord } from "./guards.js"
import { ensurePrivateDirectory, hardenPrivateFile } from "./permissions.js"
import type { Config, SourceFingerprintMode } from "./types.js"

const CACHE_VERSION = 1
export const SOURCE_FINGERPRINT_CACHE_FILENAME = "source-fingerprints.jsonl"
const MAX_FINGERPRINT_AGE_MS = 30 * 24 * 60 * 60 * 1_000
const STREAM_WRITE_BYTES = 64 * 1_024

export interface SourceFileIdentity {
  absolutePath: string
  size: number
  mtimeMs: number
  ctimeMs: number
  dev: number
  ino: number
  mode: number
}

export interface SourceFingerprintRecord extends SourceFileIdentity {
  checksum: string
  verifiedAt: string
}

export async function readSourceFingerprintCache(
  config: Config,
): Promise<Map<string, SourceFingerprintRecord> | null> {
  const records = new Map<string, SourceFingerprintRecord>()
  const stream = createReadStream(path.join(config.storageDir, SOURCE_FINGERPRINT_CACHE_FILENAME))
  stream.setEncoding("utf8")
  let buffered = ""
  let headerRead = false

  const applyLine = (line: string): boolean => {
    let value: unknown
    try {
      value = JSON.parse(line) as unknown
    } catch {
      return false
    }
    if (!headerRead) {
      headerRead = true
      return isRecord(value) && value.version === CACHE_VERSION && value.type === "header"
    }
    if (!isSourceFingerprintRecord(value) || records.has(value.absolutePath)) {
      return false
    }
    records.set(value.absolutePath, value)
    return true
  }

  try {
    for await (const chunk of stream) {
      buffered += typeof chunk === "string" ? chunk : chunk.toString("utf8")
      let lineEnd = buffered.indexOf("\n")
      while (lineEnd >= 0) {
        const line = buffered.slice(0, lineEnd)
        buffered = buffered.slice(lineEnd + 1)
        if (!line || !applyLine(line)) {
          return null
        }
        lineEnd = buffered.indexOf("\n")
      }
    }
    if (buffered && !applyLine(buffered)) {
      return null
    }
    return headerRead ? records : null
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return new Map()
    }
    throw error
  }
}

export function reusableSourceFingerprint(
  record: SourceFingerprintRecord | undefined,
  identity: SourceFileIdentity,
  mode: SourceFingerprintMode,
  now = Date.now(),
): SourceFingerprintRecord | null {
  if (
    mode === "strict" ||
    !record ||
    record.absolutePath !== identity.absolutePath ||
    record.size !== identity.size ||
    record.mtimeMs !== identity.mtimeMs ||
    record.ctimeMs !== identity.ctimeMs ||
    record.dev !== identity.dev ||
    record.ino !== identity.ino ||
    record.mode !== identity.mode
  ) {
    return null
  }
  const verifiedAt = Date.parse(record.verifiedAt)
  return Number.isFinite(verifiedAt) &&
    now >= verifiedAt &&
    now - verifiedAt <= MAX_FINGERPRINT_AGE_MS
    ? record
    : null
}

export function sourceFingerprintRecord(
  identity: SourceFileIdentity,
  checksum: string,
  verifiedAt: string,
): SourceFingerprintRecord {
  return { ...identity, checksum, verifiedAt }
}

export async function writeSourceFingerprintCache(
  records: Iterable<SourceFingerprintRecord>,
  config: Config,
): Promise<void> {
  await ensurePrivateDirectory(config.storageDir)
  const targetPath = path.join(config.storageDir, SOURCE_FINGERPRINT_CACHE_FILENAME)
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    const handle = await openFile(temporaryPath, "wx", 0o600)
    let buffered = `${JSON.stringify({ version: CACHE_VERSION, type: "header" })}\n`
    try {
      for (const record of records) {
        buffered += `${JSON.stringify(record)}\n`
        if (Buffer.byteLength(buffered) >= STREAM_WRITE_BYTES) {
          await handle.writeFile(buffered, "utf8")
          buffered = ""
        }
      }
      if (buffered) {
        await handle.writeFile(buffered, "utf8")
      }
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

function isSourceFingerprintRecord(value: unknown): value is SourceFingerprintRecord {
  return (
    isRecord(value) &&
    typeof value.absolutePath === "string" &&
    path.isAbsolute(value.absolutePath) &&
    isNonNegativeFinite(value.size) &&
    isNonNegativeFinite(value.mtimeMs) &&
    isNonNegativeFinite(value.ctimeMs) &&
    isNonNegativeFinite(value.dev) &&
    isNonNegativeFinite(value.ino) &&
    isNonNegativeFinite(value.mode) &&
    typeof value.checksum === "string" &&
    /^[0-9a-f]{64}$/u.test(value.checksum) &&
    typeof value.verifiedAt === "string" &&
    Number.isFinite(Date.parse(value.verifiedAt))
  )
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

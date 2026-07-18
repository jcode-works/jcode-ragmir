import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../dist/parsing.js"

const PAGE_COUNT = 1_000
const BATCH_SIZE = 16
const FAILURE_CALL = 10
const benchmarkDir = path.dirname(fileURLToPath(import.meta.url))
const resultDir = path.join(benchmarkDir, ".results")
const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-ocr-benchmark-"))

try {
  const pdfPath = path.join(root, "scan.pdf")
  const wrapperPath = path.join(root, "ocr-wrapper.mjs")
  const statePath = path.join(root, "ocr-state.json")
  const pdf = createBlankPdf(PAGE_COUNT)
  await writeFile(pdfPath, pdf)
  await writeFile(statePath, JSON.stringify({ calls: 0, failed: false }))
  await writeFile(
    wrapperPath,
    [
      'import { readFileSync, writeFileSync } from "node:fs"',
      `const statePath = ${JSON.stringify(statePath)}`,
      'const state = JSON.parse(readFileSync(statePath, "utf8"))',
      "state.calls += 1",
      `if (state.calls === ${FAILURE_CALL} && !state.failed) {`,
      "  state.failed = true",
      '  writeFileSync(statePath, JSON.stringify(state))',
      '  process.stderr.write("synthetic OCR interruption\\n")',
      "  process.exit(17)",
      "}",
      'writeFileSync(statePath, JSON.stringify(state))',
      'const pages = process.env.RAGMIR_PDF_PAGES.split(",").map(Number)',
      'process.stdout.write(JSON.stringify({ subprocesses: 2, pages: pages.map((page) => ({ page, text: "Synthetic scanned evidence page " + page })) }))',
    ].join("\n"),
  )
  const source = {
    absolutePath: pdfPath,
    relativePath: "scan.pdf",
    source: "scan.pdf",
    extension: ".pdf",
    bytes: Buffer.byteLength(pdf),
    mtimeMs: 0,
    checksum: createHash("sha256").update(pdf).digest("hex"),
  }
  const options = {
    projectRoot: root,
    pdfOcrCommand: [process.execPath, wrapperPath, "{input}", "{pages}"],
    pdfOcrTimeoutMs: 30_000,
  }

  let interrupted = false
  try {
    await parseFile(source, options)
  } catch (error) {
    interrupted = error instanceof Error && error.message.includes("synthetic OCR interruption")
  }
  const cachedAfterInterruption = await cacheEntryCount(root)
  const resumed = await parseFile(source, options)
  const warm = await parseFile(source, options)
  const state = JSON.parse(await readFile(statePath, "utf8"))
  const cacheEntries = await cacheEntryCount(root)
  const firstCacheFile = await firstCacheEntry(root)
  const privateFile =
    process.platform === "win32" || ((await stat(firstCacheFile)).mode & 0o777) === 0o600
  const resumedMetrics = resumed.ocr
  const warmMetrics = warm.ocr
  const warmSpeedup =
    resumedMetrics && warmMetrics && warmMetrics.durationMs > 0
      ? resumedMetrics.durationMs / warmMetrics.durationMs
      : 0
  const expectedCachedAfterInterruption = (FAILURE_CALL - 1) * BATCH_SIZE
  const maximumBatchCalls = Math.ceil(PAGE_COUNT / BATCH_SIZE) + 1
  const gates = {
    interrupted,
    resumedOnlyMissingPages:
      cachedAfterInterruption === expectedCachedAfterInterruption &&
      resumedMetrics?.cacheHits === expectedCachedAfterInterruption &&
      resumedMetrics.cacheMisses === PAGE_COUNT - expectedCachedAfterInterruption,
    boundedSubprocesses:
      typeof state.calls === "number" &&
      state.calls <= maximumBatchCalls &&
      (resumedMetrics?.batches ?? Number.POSITIVE_INFINITY) <= Math.ceil(PAGE_COUNT / BATCH_SIZE),
    completeCache: cacheEntries === PAGE_COUNT,
    stableOutput: warm.text === resumed.text,
    warmCache:
      warmMetrics?.cacheHits === PAGE_COUNT &&
      warmMetrics.cacheMisses === 0 &&
      warmMetrics.subprocesses === 0,
    privateFile,
    speedup: warmSpeedup >= 3,
  }
  const result = {
    schemaVersion: 1,
    pageCount: PAGE_COUNT,
    batchSize: BATCH_SIZE,
    failureCall: FAILURE_CALL,
    cachedAfterInterruption,
    cacheEntries,
    wrapperCalls: state.calls,
    resumed: resumedMetrics,
    warm: warmMetrics,
    warmSpeedup,
    gates,
    passed: Object.values(gates).every(Boolean),
  }
  await mkdir(resultDir, { recursive: true })
  const resultPath = path.join(resultDir, `${new Date().toISOString().replaceAll(":", "-")}-ocr.json`)
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify({ resultPath, ...result }, null, 2))
  if (!result.passed) {
    process.exitCode = 1
  }
} finally {
  await rm(root, { recursive: true, force: true })
}

async function cacheEntryCount(projectRoot) {
  const cacheRoot = path.join(projectRoot, ".ragmir", "ocr-cache")
  try {
    return (await readdir(cacheRoot, { recursive: true })).filter((entry) => entry.endsWith(".json"))
      .length
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return 0
    }
    throw error
  }
}

async function firstCacheEntry(projectRoot) {
  const cacheRoot = path.join(projectRoot, ".ragmir", "ocr-cache")
  const entry = (await readdir(cacheRoot, { recursive: true })).find((name) => name.endsWith(".json"))
  if (!entry) {
    throw new Error("OCR benchmark did not create a cache entry.")
  }
  return path.join(cacheRoot, entry)
}

function createBlankPdf(pageCount) {
  const pageObjects = Array.from(
    { length: pageCount },
    () => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
  )
  const references = pageObjects.map((_page, index) => `${index + 3} 0 R`).join(" ")
  return createPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${references}] /Count ${pageCount} >>`,
    ...pageObjects,
  ])
}

function createPdf(objects) {
  let pdf = "%PDF-1.4\n"
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return pdf
}

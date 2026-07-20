import { createHash, randomUUID } from "node:crypto"
import { createReadStream, existsSync } from "node:fs"
import {
  chmod,
  copyFile,
  lstat,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { externalExtractorsRequested, loadConfig } from "./config.js"
import {
  INDEX_MANIFEST_FILENAME,
  RAGMIR_DIR,
  RAGMIR_PORTABLE_READ_ONLY_ENV,
  RAGMIR_PROJECT_ROOT_ENV,
} from "./defaults.js"
import { embeddingModelArtifactDigest, embeddingModelArtifactRoot } from "./embeddings.js"
import { indexFreshnessWarning } from "./index-diagnostics.js"
import { withIndexWriteLock } from "./index-write-lock.js"
import { operationSignal, throwIfAborted } from "./operation.js"
import { ensurePrivateDirectory, hardenPrivateFile } from "./permissions.js"
import {
  closeRowsTable,
  closeStoreConnection,
  connectStore,
  openRowsTableByName,
  readIndexManifestHeader,
} from "./store.js"
import type { Config, IndexManifest, OperationOptions } from "./types.js"
import { VERSION } from "./version.js"

const PORTABLE_SCHEMA_VERSION = 1
const PORTABLE_KIND = "ragmir-portable-knowledge-base"
const PORTABLE_MANIFEST_FILENAME = "manifest.json"
const PORTABLE_CONFIG_PATH = path.join(RAGMIR_DIR, "config.json")
const PORTABLE_STORAGE_PATH = path.join(RAGMIR_DIR, "storage")
const PORTABLE_MODEL_PATH = path.join(RAGMIR_DIR, "models")
const PORTABLE_SOURCES_PATH = path.join(RAGMIR_DIR, "sources.txt")
const PORTABLE_RUNNER_PATH = path.join("bin", "rgr.cjs")
const PORTABLE_CONFIGURATOR_PATH = path.join("bin", "configure.cjs")
const PORTABLE_RUNTIME_PATH = "runtime"
const PORTABLE_RUNTIME_DIST_PATH = path.join(PORTABLE_RUNTIME_PATH, "dist")
const PORTABLE_SKILL_NAMES = ["ragmir-portable", "ragmir-decision-evidence"] as const
const PORTABLE_ADAPTER_FILENAMES = [
  "README.md",
  "generic-mcp.json",
  "openclaw-mcp-server.json",
  "claude-mcp-server.json",
  "codex-mcp.toml",
  "kimi-mcp.json",
  "opencode.jsonc",
  "cline-mcp.json",
  "stdio-command.txt",
] as const
const MAX_PORTABLE_MANIFEST_BYTES = 64 * 1_024 * 1_024
const MAX_PORTABLE_PACKAGE_BYTES = 1_024 * 1_024
const PORTABLE_ROOT_PLACEHOLDER = "<PORTABLE_ROOT>"
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u
const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const SAFE_TABLE_NAME_PATTERN = /^[A-Za-z0-9_-]+$/u
const INDEX_FILES_SNAPSHOT_PATTERN = /^index-manifest\.files\.[A-Za-z0-9-]+\.jsonl$/u
const PORTABLE_RUNTIME_ALWAYS_DEPENDENCIES = [
  "@lancedb/lancedb",
  "@modelcontextprotocol/sdk",
  "apache-arrow",
  "safe-regex2",
  "zod",
] as const
const PORTABLE_RUNTIME_TRANSFORMERS_DEPENDENCY = "@huggingface/transformers"
const PORTABLE_RUNTIME_OMITTED_DEPENDENCIES = new Set([
  "@hono/node-server",
  "content-type",
  "cors",
  "cross-spawn",
  "eventsource",
  "eventsource-parser",
  "express",
  "express-rate-limit",
  "hono",
  "jose",
  "onnxruntime-web",
  "pkce-challenge",
  "raw-body",
  "sharp",
])
const ONNX_RUNTIME_PLATFORM_ROOT = path.join("bin", "napi-v6", process.platform, process.arch)

const portableRelativePathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine((value) => portableRelativePath(value) !== null, "Path must stay inside the bundle.")

const portableFileSchema = z
  .object({
    path: portableRelativePathSchema,
    bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(SHA256_PATTERN),
  })
  .strict()

export const portableKnowledgeBaseManifestSchema = z
  .object({
    schemaVersion: z.literal(PORTABLE_SCHEMA_VERSION),
    kind: z.literal(PORTABLE_KIND),
    createdAt: z.string().regex(ISO_DATE_PATTERN),
    name: z.string().min(1).max(120),
    ragmirVersion: z.string().min(1).max(100),
    runtime: z
      .object({
        node: z.literal(">=22"),
        package: z.literal("@jcode.labs/ragmir"),
        packageVersion: z.string().min(1).max(100),
        resolution: z.enum(["embedded-platform-runtime", "local-install-or-pinned-npx"]),
        exportedOn: z
          .object({
            platform: z.string().min(1).max(100),
            arch: z.string().min(1).max(100),
          })
          .strict(),
      })
      .strict(),
    knowledgeBase: z
      .object({
        corpusFingerprint: z.string().regex(SHA256_PATTERN).nullable(),
        indexedFiles: z.number().int().positive(),
        indexedChunks: z.number().int().positive(),
        embeddingProvider: z.enum(["local-hash", "transformers"]),
        embeddingModel: z.string().min(1),
        embeddingModelRevision: z.string().min(1),
        embeddingModelDigest: z.string().nullable(),
        indexSchemaVersion: z.number().int().positive(),
        tableName: z.string().regex(SAFE_TABLE_NAME_PATTERN),
      })
      .strict(),
    contents: z
      .object({
        rawSourcesIncluded: z.literal(false),
        indexedTextIncluded: z.literal(true),
        accessLogsIncluded: z.literal(false),
        embeddingModelIncluded: z.boolean(),
        skills: z.array(z.enum(PORTABLE_SKILL_NAMES)).length(PORTABLE_SKILL_NAMES.length),
        adapters: z
          .array(z.enum(PORTABLE_ADAPTER_FILENAMES))
          .length(PORTABLE_ADAPTER_FILENAMES.length),
      })
      .strict(),
    files: z.array(portableFileSchema).min(1).max(200_000),
  })
  .strict()

export type PortableKnowledgeBaseManifest = z.infer<typeof portableKnowledgeBaseManifestSchema>

export interface ExportPortableKnowledgeBaseOptions extends OperationOptions {
  cwd?: string
  outputDir?: string
  name?: string
  replaceExisting?: boolean
}

export interface PortableKnowledgeBaseVerification {
  root: string
  valid: boolean
  checkedFiles: number
  errors: string[]
  warnings: string[]
  manifest: PortableKnowledgeBaseManifest | null
}

export interface ExportPortableKnowledgeBaseResult {
  outputDir: string
  previousOutputDir: string | null
  manifestPath: string
  fileCount: number
  totalBytes: number
  embeddingModelIncluded: boolean
  verification: PortableKnowledgeBaseVerification
}

interface PersistedManifestPointer {
  indexedFilesSnapshot?: string
}

export async function exportPortableKnowledgeBase(
  options: ExportPortableKnowledgeBaseOptions = {},
): Promise<ExportPortableKnowledgeBaseResult> {
  const signal = operationSignal(options)
  throwIfAborted(signal)
  const config = await loadConfig(options.cwd ?? process.cwd())
  const name = portableDisplayName(options.name ?? path.basename(config.projectRoot))
  const outputDir = path.resolve(
    config.projectRoot,
    options.outputDir ?? defaultPortableOutputPath(name),
  )
  assertPortableDestination(config, outputDir)
  const destinationExists = await pathExists(outputDir)
  if (destinationExists) {
    if (!options.replaceExisting) {
      throw new Error(
        `Portable export destination already exists: ${outputDir}. Choose a new directory or pass replaceExisting to preserve and replace its portable bundle.`,
      )
    }
    await assertReplaceablePortableDestination(outputDir)
  }
  if (externalExtractorsRequested(config)) {
    throw new Error(
      "Portable export does not copy external extractor commands. Disable PDF OCR, image OCR, and legacy Word commands, rebuild the index if needed, then export again.",
    )
  }
  if (config.embeddingProvider === "transformers" && config.embeddingModelDigest === null) {
    throw new Error(
      "Portable semantic export requires a verified embeddingModelDigest. Pull and verify the configured model before exporting.",
    )
  }

  const stagingDir = path.join(
    path.dirname(outputDir),
    `.${path.basename(outputDir)}.ragmir-staging-${randomUUID()}`,
  )
  await ensurePrivateDirectory(path.dirname(outputDir))

  try {
    const activeManifest = await withIndexWriteLock(config.storageDir, signal, async () => {
      throwIfAborted(signal)
      const currentManifest = await readIndexManifestHeader(config)
      assertExportableManifest(config, currentManifest)
      await ensurePrivateDirectory(stagingDir)
      await copyPortableStorage(stagingDir, config, currentManifest, signal)
      return currentManifest
    })
    await buildPortableDirectory(stagingDir, config, name, signal)
    const manifest = await createPortableManifest(stagingDir, config, activeManifest, name, signal)
    await writePrivateJson(path.join(stagingDir, PORTABLE_MANIFEST_FILENAME), manifest)
    const verification = await verifyPortableKnowledgeBase(stagingDir)
    if (!verification.valid) {
      throw new Error(`Portable export verification failed: ${verification.errors.join(" ")}`)
    }
    throwIfAborted(signal)
    const previousOutputDir = await activatePortableDirectory(
      stagingDir,
      outputDir,
      options.replaceExisting === true,
    )
    const totalBytes = manifest.files.reduce((sum, file) => sum + file.bytes, 0)
    return {
      outputDir,
      previousOutputDir,
      manifestPath: path.join(outputDir, PORTABLE_MANIFEST_FILENAME),
      fileCount: manifest.files.length,
      totalBytes,
      embeddingModelIncluded: manifest.contents.embeddingModelIncluded,
      verification: { ...verification, root: outputDir },
    }
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true })
    throw error
  }
}

export async function verifyPortableKnowledgeBase(
  root: string,
): Promise<PortableKnowledgeBaseVerification> {
  const resolvedRoot = path.resolve(root)
  const errors: string[] = []
  const warnings: string[] = []
  let checkedFiles = 0
  let manifest: PortableKnowledgeBaseManifest | null = null

  try {
    const manifestPath = path.join(resolvedRoot, PORTABLE_MANIFEST_FILENAME)
    const manifestStat = await lstat(manifestPath)
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
      throw new Error("manifest.json must be a regular file.")
    }
    if (manifestStat.size > MAX_PORTABLE_MANIFEST_BYTES) {
      throw new Error(`manifest.json exceeds ${MAX_PORTABLE_MANIFEST_BYTES} bytes.`)
    }
    manifest = portableKnowledgeBaseManifestSchema.parse(
      JSON.parse(await readFile(manifestPath, "utf8")),
    )
  } catch (error) {
    errors.push(`Manifest validation failed: ${errorMessage(error)}`)
    return { root: resolvedRoot, valid: false, checkedFiles, errors, warnings, manifest }
  }

  const seenPaths = new Set<string>()
  for (const expected of manifest.files) {
    if (seenPaths.has(expected.path)) {
      errors.push(`Duplicate manifest path: ${expected.path}.`)
      continue
    }
    seenPaths.add(expected.path)
    const relativePath = portableRelativePath(expected.path)
    if (relativePath === null) {
      errors.push(`Unsafe manifest path: ${expected.path}.`)
      continue
    }
    const filePath = path.join(resolvedRoot, ...relativePath.split("/"))
    try {
      const details = await lstat(filePath)
      if (!details.isFile() || details.isSymbolicLink()) {
        errors.push(`Managed path is not a regular file: ${expected.path}.`)
        continue
      }
      if (details.size !== expected.bytes) {
        errors.push(`Size mismatch for ${expected.path}.`)
        continue
      }
      const sha256 = await hashFile(filePath)
      if (sha256 !== expected.sha256) {
        errors.push(`SHA-256 mismatch for ${expected.path}.`)
        continue
      }
      checkedFiles += 1
    } catch (error) {
      errors.push(`Cannot verify ${expected.path}: ${errorMessage(error)}`)
    }
  }

  if (errors.length === 0) {
    try {
      const config = await loadConfig(resolvedRoot)
      assertPortableRuntimeConfig(config, resolvedRoot)
      const indexManifest = await readIndexManifestHeader(config)
      if (!indexManifest) {
        throw new Error("The active Ragmir index manifest is missing or invalid.")
      }
      const freshnessWarning = indexFreshnessWarning(config, indexManifest)
      if (freshnessWarning) {
        throw new Error(freshnessWarning)
      }
      if (indexManifest.corpusFingerprint !== manifest.knowledgeBase.corpusFingerprint) {
        throw new Error(
          "The portable manifest and active index have different corpus fingerprints.",
        )
      }
      if (indexManifest.chunkCount !== manifest.knowledgeBase.indexedChunks) {
        throw new Error("The portable manifest and active index have different chunk counts.")
      }
      if (config.embeddingProvider === "transformers") {
        const digest = await embeddingModelArtifactDigest(config)
        if (digest !== config.embeddingModelDigest) {
          throw new Error(
            `Portable embedding model digest mismatch: expected ${config.embeddingModelDigest}, received ${digest}.`,
          )
        }
      }
      await verifyPortableTable(config, manifest.knowledgeBase.tableName, indexManifest.chunkCount)
    } catch (error) {
      errors.push(`Runtime validation failed: ${errorMessage(error)}`)
    }
  }

  if (
    manifest.runtime.exportedOn.platform !== process.platform ||
    manifest.runtime.exportedOn.arch !== process.arch
  ) {
    const message = `This bundle was exported for ${manifest.runtime.exportedOn.platform}/${manifest.runtime.exportedOn.arch}, but this host is ${process.platform}/${process.arch}.`
    if (manifest.runtime.resolution === "embedded-platform-runtime") {
      errors.push(`${message} Re-export it on a matching platform before use.`)
    } else {
      warnings.push(`${message} Verify retrieval before relying on it.`)
    }
  }

  return {
    root: resolvedRoot,
    valid: errors.length === 0,
    checkedFiles,
    errors,
    warnings,
    manifest,
  }
}

function defaultPortableOutputPath(name: string): string {
  return path.join(RAGMIR_DIR, "exports", `${portableSlug(name)}-${portableTimestamp()}`)
}

function portableTimestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z")
}

async function activatePortableDirectory(
  stagingDir: string,
  outputDir: string,
  replaceExisting: boolean,
): Promise<string | null> {
  if (!(await pathExists(outputDir))) {
    await rename(stagingDir, outputDir)
    return null
  }
  if (!replaceExisting) {
    throw new Error(
      `Portable export destination appeared before activation: ${outputDir}. Run the export again with a new destination.`,
    )
  }

  await assertReplaceablePortableDestination(outputDir)
  const previousOutputDir = `${outputDir}.previous-${portableTimestamp()}-${randomUUID().slice(0, 8)}`
  await rename(outputDir, previousOutputDir)
  try {
    await rename(stagingDir, outputDir)
    return previousOutputDir
  } catch (activationError) {
    try {
      await rename(previousOutputDir, outputDir)
    } catch (rollbackError) {
      throw new AggregateError(
        [activationError, rollbackError],
        `Portable activation and rollback both failed. The previous bundle remains at ${previousOutputDir}.`,
      )
    }
    throw activationError
  }
}

async function assertReplaceablePortableDestination(outputDir: string): Promise<void> {
  try {
    const rootDetails = await lstat(outputDir)
    if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) {
      throw new Error("the destination is not a regular directory")
    }

    const manifestPath = path.join(outputDir, PORTABLE_MANIFEST_FILENAME)
    const manifestDetails = await lstat(manifestPath)
    if (!manifestDetails.isFile() || manifestDetails.isSymbolicLink()) {
      throw new Error("manifest.json is not a regular file")
    }
    if (manifestDetails.size > MAX_PORTABLE_MANIFEST_BYTES) {
      throw new Error(`manifest.json exceeds ${MAX_PORTABLE_MANIFEST_BYTES} bytes`)
    }
    const manifestValue: unknown = JSON.parse(await readFile(manifestPath, "utf8"))
    if (
      typeof manifestValue !== "object" ||
      manifestValue === null ||
      Array.isArray(manifestValue) ||
      Reflect.get(manifestValue, "kind") !== PORTABLE_KIND
    ) {
      throw new Error(`manifest.json does not declare ${PORTABLE_KIND}`)
    }

    const packagePath = path.join(outputDir, "package.json")
    const packageDetails = await lstat(packagePath)
    if (!packageDetails.isFile() || packageDetails.isSymbolicLink()) {
      throw new Error("package.json is not a regular file")
    }
    if (packageDetails.size > MAX_PORTABLE_PACKAGE_BYTES) {
      throw new Error(`package.json exceeds ${MAX_PORTABLE_PACKAGE_BYTES} bytes`)
    }
    const packageValue: unknown = JSON.parse(await readFile(packagePath, "utf8"))
    if (
      typeof packageValue !== "object" ||
      packageValue === null ||
      Array.isArray(packageValue) ||
      Reflect.get(packageValue, "name") !== "ragmir-portable-knowledge-base"
    ) {
      throw new Error("package.json does not declare a Ragmir portable knowledge base")
    }
  } catch (error) {
    throw new Error(
      `Portable replacement refused for ${outputDir}: ${errorMessage(error)}. Move the existing directory aside manually before retrying.`,
    )
  }
}

function portableDisplayName(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, " ")
  if (
    normalized.length === 0 ||
    normalized.length > 120 ||
    [...normalized].some((character) => {
      const code = character.charCodeAt(0)
      return code <= 31 || code === 127
    })
  ) {
    throw new Error("Portable knowledge-base name must contain 1 to 120 printable characters.")
  }
  return normalized
}

function portableSlug(value: string): string {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
  return slug.length > 0 ? slug.slice(0, 80) : "knowledge-base"
}

function assertPortableDestination(config: Config, outputDir: string): void {
  const protectedPaths = [config.rawDir, config.storageDir, config.embeddingModelPath]
  for (const protectedPath of protectedPaths) {
    if (pathContains(protectedPath, outputDir) || pathContains(outputDir, protectedPath)) {
      throw new Error(
        `Portable export destination must not overlap Ragmir source, storage, or model directories: ${outputDir}.`,
      )
    }
  }
  const defaultExportRoot = path.join(config.projectRoot, RAGMIR_DIR, "exports")
  if (pathContains(config.projectRoot, outputDir) && !pathContains(defaultExportRoot, outputDir)) {
    throw new Error(
      `Portable exports inside the project must stay under ${defaultExportRoot} so indexed passages cannot be committed or ingested accidentally. Choose a destination outside the project otherwise.`,
    )
  }
}

function assertExportableManifest(
  config: Config,
  manifest: IndexManifest | null,
): asserts manifest is IndexManifest {
  if (!manifest) {
    throw new Error("Ragmir has no valid index to export. Run `rgr ingest` first.")
  }
  if (manifest.fileCount <= 0 || manifest.chunkCount <= 0) {
    throw new Error("Ragmir index is empty. Ingest at least one supported source before exporting.")
  }
  if (!manifest.health) {
    throw new Error(
      "Ragmir index has no health snapshot. Run `rgr ingest --rebuild` before exporting.",
    )
  }
  if (
    manifest.health.missingFromIndex > 0 ||
    manifest.health.staleInIndex > 0 ||
    manifest.health.emptyTextFiles > 0 ||
    manifest.health.oversizedFiles > 0
  ) {
    throw new Error(
      "Ragmir index coverage is incomplete. Resolve missing, stale, empty, or oversized sources before exporting.",
    )
  }
  if (manifest.health.securityWarnings.length > 0) {
    throw new Error("Ragmir index has unresolved security warnings. Resolve them before exporting.")
  }
  const freshnessWarning = indexFreshnessWarning(config, manifest)
  if (freshnessWarning) {
    throw new Error(freshnessWarning)
  }
  const tableName = manifest.tableName ?? config.tableName
  if (!SAFE_TABLE_NAME_PATTERN.test(tableName)) {
    throw new Error("Ragmir active table name is not portable.")
  }
}

async function buildPortableDirectory(
  root: string,
  config: Config,
  name: string,
  signal: AbortSignal | undefined,
): Promise<void> {
  await ensurePrivateDirectory(root)
  await ensurePrivateDirectory(path.join(root, RAGMIR_DIR))
  await writePrivateJson(path.join(root, PORTABLE_CONFIG_PATH), portableConfig(config))
  await writePrivateText(path.join(root, PORTABLE_SOURCES_PATH), "")

  const embeddingModelIncluded = config.embeddingProvider === "transformers"
  if (embeddingModelIncluded) {
    const sourceModelRoot = embeddingModelArtifactRoot(config)
    if (!(await directoryExists(sourceModelRoot))) {
      throw new Error(
        `Configured embedding model directory is missing: ${sourceModelRoot}. Pull the model before exporting.`,
      )
    }
    await copyPrivateTree(
      sourceModelRoot,
      path.join(root, PORTABLE_MODEL_PATH, config.embeddingModel),
      signal,
    )
  }

  await copyPortableRuntime(root, embeddingModelIncluded, signal)
  await writePrivateJson(path.join(root, "package.json"), portablePackageManifest())
  await writeExecutable(path.join(root, PORTABLE_RUNNER_PATH), portableRunnerSource())
  await writeExecutable(path.join(root, PORTABLE_CONFIGURATOR_PATH), portableConfiguratorSource())
  await writePortableSkills(root)
  await writePortableAdapters(root)
  await writePrivateText(path.join(root, "README.md"), portableReadme(name, embeddingModelIncluded))
}

function portableConfig(config: Config): Record<string, unknown> {
  return {
    privacyProfile: config.privacyProfile,
    retrievalProfile: config.retrievalProfile,
    acceptedRisks: [],
    rawDir: ".ragmir/source-unavailable",
    storageDir: ".ragmir/storage",
    sourcesFile: ".ragmir/sources.txt",
    sources: [],
    accessLogPath: ".ragmir/access.log",
    embeddingModelPath: ".ragmir/models",
    tableName: config.tableName,
    embeddingProvider: config.embeddingProvider,
    embeddingModel: config.embeddingModel,
    embeddingModelRevision: config.embeddingModelRevision,
    embeddingModelDigest: config.embeddingModelDigest,
    transformersAllowRemoteModels: false,
    redaction: config.redaction,
    accessLog: false,
    mcpMaxTopK: config.mcpMaxTopK,
    mcpMaxOutputBytes: config.mcpMaxOutputBytes,
    topK: config.topK,
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
    maxFileBytes: config.maxFileBytes,
    ingestConcurrency: config.ingestConcurrency,
    embeddingBatchSize: config.embeddingBatchSize,
    sourceFingerprintMode: config.sourceFingerprintMode,
    incrementalFailurePolicy: config.incrementalFailurePolicy,
    hybridTextScanLimit: config.hybridTextScanLimit,
    workloadLimits: config.workloadLimits,
    includeExtensions: config.includeExtensions,
    pdfOcrCommand: [],
    pdfOcrTimeoutMs: config.pdfOcrTimeoutMs,
    imageOcrCommand: [],
    imageOcrTimeoutMs: config.imageOcrTimeoutMs,
    legacyWordCommand: [],
    legacyWordTimeoutMs: config.legacyWordTimeoutMs,
  }
}

async function copyPortableRuntime(
  root: string,
  embeddingModelIncluded: boolean,
  signal: AbortSignal | undefined,
): Promise<void> {
  const sourcePackageRoot = portableSourcePackageRoot()
  const sourceDist = path.join(sourcePackageRoot, "dist")
  const portableEntry = path.join(sourceDist, "portable-entry.js")
  if (!(await pathExists(portableEntry))) {
    throw new Error(
      "Portable runtime is not built. Build @jcode.labs/ragmir before exporting a standalone knowledge base.",
    )
  }

  const runtimeRoot = path.join(root, PORTABLE_RUNTIME_PATH)
  await copyPortableRuntimeTree(sourceDist, path.join(root, PORTABLE_RUNTIME_DIST_PATH), signal)
  await writePrivateJson(path.join(runtimeRoot, "package.json"), {
    name: "ragmir-portable-runtime",
    private: true,
    type: "module",
    engines: { node: ">=22" },
  })

  const dependencies = [
    ...PORTABLE_RUNTIME_ALWAYS_DEPENDENCIES,
    ...(embeddingModelIncluded ? [PORTABLE_RUNTIME_TRANSFORMERS_DEPENDENCY] : []),
  ]
  const copiedPackages = new Map<string, string>()
  for (const dependency of dependencies) {
    await copyPortableRuntimePackage({
      packageName: dependency,
      sourceParentRoot: sourcePackageRoot,
      targetParentRoot: path.join(root, PORTABLE_RUNTIME_PATH),
      copiedPackages,
      signal,
      optional: false,
    })
  }
  if (embeddingModelIncluded) {
    await copyPortableTransformersCompatibilityRuntime(
      sourcePackageRoot,
      runtimeRoot,
      copiedPackages,
      signal,
    )
    await writePortableSharpStub(runtimeRoot)
  }
}

async function copyPortableTransformersCompatibilityRuntime(
  sourcePackageRoot: string,
  runtimeRoot: string,
  copiedPackages: Map<string, string>,
  signal: AbortSignal | undefined,
): Promise<void> {
  const transformersRoot = await installedPackageRoot(
    sourcePackageRoot,
    PORTABLE_RUNTIME_TRANSFORMERS_DEPENDENCY,
    false,
  )
  if (!transformersRoot) {
    throw new Error("Portable Transformers runtime is unavailable.")
  }
  const onnxRuntimeRoot = await installedPackageRoot(transformersRoot, "onnxruntime-node", false)
  if (!onnxRuntimeRoot) {
    throw new Error("Portable ONNX runtime is unavailable.")
  }
  await copyPortableRuntimePackage({
    packageName: "onnxruntime-common",
    sourceParentRoot: onnxRuntimeRoot,
    targetParentRoot: runtimeRoot,
    copiedPackages,
    signal,
    optional: false,
  })
}

async function writePortableSharpStub(runtimeRoot: string): Promise<void> {
  const packageRoot = path.join(runtimeRoot, "node_modules", "sharp")
  await writePrivateJson(path.join(packageRoot, "package.json"), {
    name: "sharp",
    private: true,
    type: "module",
    exports: "./index.js",
  })
  await writePrivateText(
    path.join(packageRoot, "index.js"),
    'const sharp = () => { throw new Error("Image processing is unavailable in this text-retrieval bundle.") }\nexport default sharp\n',
  )
}

function portableSourcePackageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
}

interface CopyPortableRuntimePackageOptions {
  packageName: string
  sourceParentRoot: string
  targetParentRoot: string
  copiedPackages: Map<string, string>
  signal: AbortSignal | undefined
  optional: boolean
}

async function copyPortableRuntimePackage(
  options: CopyPortableRuntimePackageOptions,
): Promise<void> {
  throwIfAborted(options.signal)
  if (PORTABLE_RUNTIME_OMITTED_DEPENDENCIES.has(options.packageName)) {
    return
  }
  const sourceRoot = await installedPackageRoot(
    options.sourceParentRoot,
    options.packageName,
    options.optional,
  )
  if (sourceRoot === null) {
    return
  }

  const targetRoot = path.join(
    options.targetParentRoot,
    "node_modules",
    ...options.packageName.split("/"),
  )
  const existingSource = options.copiedPackages.get(targetRoot)
  if (existingSource) {
    if (existingSource !== sourceRoot) {
      throw new Error(
        `Portable runtime cannot embed conflicting installed versions of ${options.packageName} at ${targetRoot}.`,
      )
    }
    return
  }
  options.copiedPackages.set(targetRoot, sourceRoot)

  const packageManifestPath = path.join(sourceRoot, "package.json")
  const packageManifest = JSON.parse(await readFile(packageManifestPath, "utf8")) as unknown
  const packageDetails = runtimePackageDetails(packageManifest, options.packageName)
  await copyPortableRuntimeTree(sourceRoot, targetRoot, options.signal, options.packageName)

  const dependencies = [
    ...Object.keys(packageDetails.dependencies),
    ...Object.keys(packageDetails.optionalDependencies),
  ].sort((left, right) => left.localeCompare(right))
  for (const dependency of dependencies) {
    await copyPortableRuntimePackage({
      ...options,
      packageName: dependency,
      sourceParentRoot: sourceRoot,
      targetParentRoot: targetRoot,
      optional: dependency in packageDetails.optionalDependencies,
    })
  }
}

async function installedPackageRoot(
  sourceParentRoot: string,
  packageName: string,
  optional: boolean,
): Promise<string | null> {
  let current = path.resolve(sourceParentRoot)
  while (true) {
    const candidate = path.join(current, "node_modules", ...packageName.split("/"))
    try {
      return await realpath(candidate)
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw new Error(
          `Portable runtime dependency ${packageName} is unavailable from ${sourceParentRoot}: ${errorMessage(error)}`,
        )
      }
    }
    const parent = path.dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }
  if (optional) {
    return null
  }
  throw new Error(
    `Portable runtime dependency ${packageName} is unavailable from ${sourceParentRoot}.`,
  )
}

function runtimePackageDetails(
  value: unknown,
  expectedName: string,
): {
  dependencies: Record<string, string>
  optionalDependencies: Record<string, string>
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Portable runtime package metadata is invalid for ${expectedName}.`)
  }
  if (Reflect.get(value, "name") !== expectedName) {
    throw new Error(`Portable runtime package metadata has an unexpected name for ${expectedName}.`)
  }
  return {
    dependencies: runtimeDependencyRecord(Reflect.get(value, "dependencies"), expectedName),
    optionalDependencies: runtimeDependencyRecord(
      Reflect.get(value, "optionalDependencies"),
      expectedName,
    ),
  }
}

function runtimeDependencyRecord(value: unknown, packageName: string): Record<string, string> {
  if (value === undefined) {
    return {}
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Portable runtime dependencies are invalid for ${packageName}.`)
  }
  const dependencies: Record<string, string> = {}
  for (const [name, version] of Object.entries(value)) {
    if (typeof version !== "string") {
      throw new Error(`Portable runtime dependency ${name} is invalid for ${packageName}.`)
    }
    dependencies[name] = version
  }
  return dependencies
}

async function copyPortableRuntimeTree(
  source: string,
  destination: string,
  signal: AbortSignal | undefined,
  packageName: string | null = null,
  relativePath = "",
): Promise<void> {
  throwIfAborted(signal)
  const details = await lstat(source)
  if (details.isSymbolicLink()) {
    throw new Error(`Portable runtime does not follow symbolic links: ${source}.`)
  }
  if (details.isDirectory()) {
    if (relativePath === "node_modules") {
      return
    }
    await ensurePrivateDirectory(destination)
    const entries = await readdir(source, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const nextRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name
      if (shouldSkipPortableRuntimePath(packageName, nextRelativePath)) {
        continue
      }
      await copyPortableRuntimeTree(
        path.join(source, entry.name),
        path.join(destination, entry.name),
        signal,
        packageName,
        nextRelativePath,
      )
    }
    return
  }
  if (!details.isFile()) {
    throw new Error(`Portable runtime supports regular files only: ${source}.`)
  }
  await ensurePrivateDirectory(path.dirname(destination))
  await copyFile(source, destination)
  await hardenPrivateFile(destination)
}

function shouldSkipPortableRuntimePath(packageName: string | null, relativePath: string): boolean {
  if (relativePath === "node_modules" || relativePath.startsWith(`node_modules${path.sep}`)) {
    return true
  }
  if (packageName !== "onnxruntime-node") {
    return false
  }
  const normalized = relativePath.split(path.sep).join("/")
  const platformRoot = ONNX_RUNTIME_PLATFORM_ROOT.split(path.sep).join("/")
  return (
    normalized.startsWith("bin/napi-v6/") &&
    !platformRoot.startsWith(normalized) &&
    !normalized.startsWith(`${platformRoot}/`)
  )
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && Reflect.get(error, "code") === "ENOENT"
}

async function copyPortableStorage(
  root: string,
  config: Config,
  manifest: IndexManifest,
  signal: AbortSignal | undefined,
): Promise<void> {
  const targetStorage = path.join(root, PORTABLE_STORAGE_PATH)
  await ensurePrivateDirectory(targetStorage)
  const tableName = manifest.tableName ?? config.tableName
  const tableDirectoryName = `${tableName}.lance`
  await copyPrivateTree(
    path.join(config.storageDir, tableDirectoryName),
    path.join(targetStorage, tableDirectoryName),
    signal,
  )

  const databaseManifestPath = path.join(config.storageDir, "__manifest")
  if (await pathExists(databaseManifestPath)) {
    await copyPrivateTree(databaseManifestPath, path.join(targetStorage, "__manifest"), signal)
  }

  const sourceManifestPath = path.join(config.storageDir, INDEX_MANIFEST_FILENAME)
  await copyPrivateTree(
    sourceManifestPath,
    path.join(targetStorage, INDEX_MANIFEST_FILENAME),
    signal,
  )
  const pointer = persistedManifestPointer(await readFile(sourceManifestPath, "utf8"))
  if (pointer.indexedFilesSnapshot) {
    await copyPrivateTree(
      path.join(config.storageDir, pointer.indexedFilesSnapshot),
      path.join(targetStorage, pointer.indexedFilesSnapshot),
      signal,
    )
  }
}

function persistedManifestPointer(raw: string): PersistedManifestPointer {
  const value: unknown = JSON.parse(raw)
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Ragmir persisted index manifest is invalid.")
  }
  const snapshot = Reflect.get(value, "indexedFilesSnapshot")
  if (snapshot === undefined) {
    return {}
  }
  if (typeof snapshot !== "string" || !INDEX_FILES_SNAPSHOT_PATTERN.test(snapshot)) {
    throw new Error("Ragmir index file snapshot path is not portable.")
  }
  return { indexedFilesSnapshot: snapshot }
}

async function createPortableManifest(
  root: string,
  config: Config,
  indexManifest: IndexManifest,
  name: string,
  signal: AbortSignal | undefined,
): Promise<PortableKnowledgeBaseManifest> {
  const files = await portableFileInventory(root, signal)
  const tableName = indexManifest.tableName ?? config.tableName
  return portableKnowledgeBaseManifestSchema.parse({
    schemaVersion: PORTABLE_SCHEMA_VERSION,
    kind: PORTABLE_KIND,
    createdAt: new Date().toISOString(),
    name,
    ragmirVersion: VERSION,
    runtime: {
      node: ">=22",
      package: "@jcode.labs/ragmir",
      packageVersion: VERSION,
      resolution: "embedded-platform-runtime",
      exportedOn: { platform: process.platform, arch: process.arch },
    },
    knowledgeBase: {
      corpusFingerprint: indexManifest.corpusFingerprint ?? null,
      indexedFiles: indexManifest.fileCount,
      indexedChunks: indexManifest.chunkCount,
      embeddingProvider: config.embeddingProvider,
      embeddingModel: config.embeddingModel,
      embeddingModelRevision: config.embeddingModelRevision,
      embeddingModelDigest: config.embeddingModelDigest,
      indexSchemaVersion: indexManifest.schemaVersion,
      tableName,
    },
    contents: {
      rawSourcesIncluded: false,
      indexedTextIncluded: true,
      accessLogsIncluded: false,
      embeddingModelIncluded: config.embeddingProvider === "transformers",
      skills: [...PORTABLE_SKILL_NAMES],
      adapters: [...PORTABLE_ADAPTER_FILENAMES],
    },
    files,
  })
}

async function portableFileInventory(
  root: string,
  signal: AbortSignal | undefined,
): Promise<PortableKnowledgeBaseManifest["files"]> {
  const relativeFiles = await walkRegularFiles(root, root, signal)
  const inventory: PortableKnowledgeBaseManifest["files"] = []
  for (const relativePath of relativeFiles) {
    throwIfAborted(signal)
    if (relativePath === PORTABLE_MANIFEST_FILENAME) {
      continue
    }
    const filePath = path.join(root, ...relativePath.split("/"))
    const details = await stat(filePath)
    inventory.push({ path: relativePath, bytes: details.size, sha256: await hashFile(filePath) })
  }
  return inventory.sort((left, right) => left.path.localeCompare(right.path))
}

async function walkRegularFiles(
  root: string,
  directory: string,
  signal: AbortSignal | undefined,
): Promise<string[]> {
  throwIfAborted(signal)
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    throwIfAborted(signal)
    const entryPath = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      throw new Error(`Portable exports do not follow symbolic links: ${entryPath}.`)
    }
    if (entry.isDirectory()) {
      files.push(...(await walkRegularFiles(root, entryPath, signal)))
      continue
    }
    if (!entry.isFile()) {
      throw new Error(`Portable exports support regular files only: ${entryPath}.`)
    }
    files.push(path.relative(root, entryPath).split(path.sep).join("/"))
  }
  return files
}

async function copyPrivateTree(
  source: string,
  destination: string,
  signal: AbortSignal | undefined,
): Promise<void> {
  throwIfAborted(signal)
  const details = await lstat(source)
  if (details.isSymbolicLink()) {
    throw new Error(`Portable exports do not follow symbolic links: ${source}.`)
  }
  if (details.isDirectory()) {
    await ensurePrivateDirectory(destination)
    const entries = await readdir(source, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      await copyPrivateTree(
        path.join(source, entry.name),
        path.join(destination, entry.name),
        signal,
      )
    }
    return
  }
  if (!details.isFile()) {
    throw new Error(`Portable exports support regular files only: ${source}.`)
  }
  await ensurePrivateDirectory(path.dirname(destination))
  await copyFile(source, destination)
  await hardenPrivateFile(destination)
}

async function writePortableSkills(root: string): Promise<void> {
  const skillRoot = path.join(root, "skills")
  await writePrivateText(
    path.join(skillRoot, "ragmir-portable", "SKILL.md"),
    portableRetrievalSkill(),
  )
  await writePrivateText(
    path.join(skillRoot, "ragmir-decision-evidence", "SKILL.md"),
    portableDecisionSkill(),
  )
}

async function writePortableAdapters(root: string): Promise<void> {
  const adapterRoot = path.join(root, "adapters")
  for (const [filename, contents] of Object.entries(portableAdapterFiles())) {
    await writePrivateText(path.join(adapterRoot, filename), contents)
  }
}

function portableAdapterFiles(): Record<(typeof PORTABLE_ADAPTER_FILENAMES)[number], string> {
  const runner = `${PORTABLE_ROOT_PLACEHOLDER}/bin/rgr.cjs`
  const env = {
    [RAGMIR_PROJECT_ROOT_ENV]: PORTABLE_ROOT_PLACEHOLDER,
    [RAGMIR_PORTABLE_READ_ONLY_ENV]: "1",
  }
  const generic = {
    mcpServers: {
      ragmir: { command: "node", args: [runner, "serve-mcp"], cwd: PORTABLE_ROOT_PLACEHOLDER, env },
    },
  }
  const openclaw = {
    command: "node",
    args: [runner, "serve-mcp"],
    cwd: PORTABLE_ROOT_PLACEHOLDER,
    env,
    toolFilter: {
      include: [
        "ragmir_status",
        "ragmir_route_prompt",
        "ragmir_search",
        "ragmir_ask",
        "ragmir_expand",
      ],
    },
  }
  const claude = { type: "stdio", command: "node", args: [runner, "serve-mcp"], env }
  const opencode = {
    $schema: "https://opencode.ai/config.json",
    mcp: {
      ragmir: {
        type: "local",
        command: ["node", runner, "serve-mcp"],
        enabled: true,
        environment: env,
      },
    },
  }
  const codex = `[mcp_servers.ragmir]
command = "node"
args = [${JSON.stringify(runner)}, "serve-mcp"]
cwd = ${JSON.stringify(PORTABLE_ROOT_PLACEHOLDER)}

[[skills.config]]
path = ${JSON.stringify(`${PORTABLE_ROOT_PLACEHOLDER}/skills/ragmir-portable`)}
enabled = true

[[skills.config]]
path = ${JSON.stringify(`${PORTABLE_ROOT_PLACEHOLDER}/skills/ragmir-decision-evidence`)}
enabled = true
`
  return {
    "README.md": portableAdapterReadme(),
    "generic-mcp.json": `${JSON.stringify(generic, null, 2)}\n`,
    "openclaw-mcp-server.json": `${JSON.stringify(openclaw, null, 2)}\n`,
    "claude-mcp-server.json": `${JSON.stringify(claude, null, 2)}\n`,
    "codex-mcp.toml": codex,
    "kimi-mcp.json": `${JSON.stringify(generic, null, 2)}\n`,
    "opencode.jsonc": `${JSON.stringify(opencode, null, 2)}\n`,
    "cline-mcp.json": `${JSON.stringify(generic, null, 2)}\n`,
    "stdio-command.txt": `node ${runner} serve-mcp\n`,
  }
}

function portablePackageManifest(): Record<string, unknown> {
  return {
    name: "ragmir-portable-knowledge-base",
    private: true,
    type: "module",
    engines: { node: ">=22" },
    ragmirRuntime: "embedded-platform-runtime",
  }
}

function portableRunnerSource(): string {
  return `#!/usr/bin/env node
const { existsSync, readFileSync } = require("node:fs")
const path = require("node:path")
const { pathToFileURL } = require("node:url")

const ROOT = path.resolve(__dirname, "..")
const ALLOWED_COMMANDS = new Set([
  "ask",
  "doctor",
  "route-prompt",
  "search",
  "serve-mcp",
  "status",
])
const args = process.argv.slice(2)

function reject(message) {
  console.error(message)
  process.exit(1)
}

function assertEmbeddedRuntimePlatform() {
  let runtime
  try {
    runtime = JSON.parse(readFileSync(path.join(ROOT, "manifest.json"), "utf8")).runtime
  } catch {
    reject("Portable manifest is missing or invalid. Run portable verify before using this bundle.")
  }
  if (!runtime || runtime.resolution !== "embedded-platform-runtime") return
  if (runtime.exportedOn?.platform === process.platform && runtime.exportedOn?.arch === process.arch) return
  reject(
    "This bundle targets " + runtime.exportedOn?.platform + "/" + runtime.exportedOn?.arch +
      ", but this host is " + process.platform + "/" + process.arch +
      ". Re-export it on the destination platform before querying it.",
  )
}

if (args.length === 0) {
  reject("Usage: node bin/rgr.cjs <search|ask|status|doctor|route-prompt|serve-mcp|portable verify> [...args]")
}
if (args[0] === "portable") {
  if (args[1] !== "verify") reject("Portable bundles allow only the portable verify subcommand.")
} else if (args[0] !== "--help" && args[0] !== "--version" && !ALLOWED_COMMANDS.has(args[0])) {
  reject("This frozen bundle blocks index and source mutation commands.")
}
if (args[0] === "doctor" && args.includes("--fix")) {
  reject("This frozen bundle blocks doctor --fix.")
}
const cliPath = path.join(ROOT, "runtime", "dist", "portable-entry.js")
if (!existsSync(cliPath)) {
  reject("Portable runtime is missing. Re-export this knowledge base from its authoritative source.")
}
if (args[0] !== "portable" && args[0] !== "--help" && args[0] !== "--version") {
  assertEmbeddedRuntimePlatform()
}
process.chdir(ROOT)
process.env.${RAGMIR_PROJECT_ROOT_ENV} = ROOT
process.env.${RAGMIR_PORTABLE_READ_ONLY_ENV} = "1"

process.argv = [process.execPath, cliPath, ...args]
import(pathToFileURL(cliPath).href).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
`
}

function portableConfiguratorSource(): string {
  return `#!/usr/bin/env node
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const runner = path.join(root, "bin", "rgr.cjs")
const target = (process.argv[2] || "generic").toLowerCase()
const env = {
  ${RAGMIR_PROJECT_ROOT_ENV}: root,
  ${RAGMIR_PORTABLE_READ_ONLY_ENV}: "1",
}
const server = { command: process.execPath, args: [runner, "serve-mcp"], cwd: root, env }
const openclawServer = {
  ...server,
  toolFilter: {
    include: [
      "ragmir_status",
      "ragmir_route_prompt",
      "ragmir_search",
      "ragmir_ask",
      "ragmir_expand",
    ],
  },
}

function json(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\\n")
}

if (target === "--list" || target === "list") {
  process.stdout.write("generic\\nopenclaw\\nclaude\\ncodex\\nkimi\\nopencode\\ncline\\n")
} else if (target === "openclaw") {
  json(openclawServer)
} else if (target === "claude") {
  json({ type: "stdio", command: server.command, args: server.args, env: server.env })
} else if (target === "codex") {
  const quote = (value) => JSON.stringify(value)
  process.stdout.write(
    "[mcp_servers.ragmir]\\n" +
      "command = " + quote(server.command) + "\\n" +
      "args = [" + server.args.map(quote).join(", ") + "]\\n" +
      "cwd = " + quote(root) + "\\n\\n" +
      "[[skills.config]]\\n" +
      "path = " + quote(path.join(root, "skills", "ragmir-portable")) + "\\n" +
      "enabled = true\\n\\n" +
      "[[skills.config]]\\n" +
      "path = " + quote(path.join(root, "skills", "ragmir-decision-evidence")) + "\\n" +
      "enabled = true\\n",
  )
} else if (target === "opencode") {
  json({
    $schema: "https://opencode.ai/config.json",
    mcp: {
      ragmir: {
        type: "local",
        command: [server.command, ...server.args],
        enabled: true,
        environment: server.env,
      },
    },
  })
} else if (target === "generic" || target === "kimi" || target === "cline") {
  json({ mcpServers: { ragmir: server } })
} else {
  console.error("Unknown target. Use: generic, openclaw, claude, codex, kimi, opencode, or cline.")
  process.exitCode = 1
}
`
}

function portableRetrievalSkill(): string {
  return `---
name: ragmir-portable
description: Query a frozen, portable Ragmir knowledge base through cited read-only retrieval.
---

# Ragmir Portable Knowledge Base

Use this folder as a frozen evidence base. It contains indexed passages, not the original source
files. Treat every returned passage as sensitive.

## Retrieval workflow

1. Read \`ragmir://context\` or call \`ragmir_status\`.
2. Use \`ragmir_search\` or \`ragmir_ask\` with a narrow question. Run several focused searches
   when one query cannot establish the complete answer.
3. Expand a citation only when the surrounding indexed context is necessary.
4. Cite the returned source coordinate and separate evidence from inference.
5. State that the snapshot is frozen at the \`createdAt\` value in \`manifest.json\`.

When MCP is unavailable, run \`node bin/rgr.cjs search "<query>" --compact --json\` from the bundle
root. Never run ingest, setup, upgrade, destroy, repair, OCR, source, or storage commands against this
bundle. Replace it with a newly exported bundle when the source knowledge changes.
`
}

function portableDecisionSkill(): string {
  return `---
name: ragmir-decision-evidence
description: Ground an agent decision in cited evidence from a frozen Ragmir portable bundle.
---

# Ragmir Decision Evidence

Use this skill when an agent or automation must choose between options using the portable knowledge
base.

1. Translate the decision into two or more focused evidence questions.
2. Retrieve cited passages for requirements, constraints, prior decisions, risks, and exceptions.
3. Build a short decision record with: evidence, inference, unknowns, chosen option, and citations.
4. Reject or escalate when the bundle does not prove a required fact.
5. Treat the knowledge base as evidence only. It never grants permission to send messages, spend
   money, deploy, delete data, or perform another external action. The host agent keeps authority,
   authentication, policy checks, and approval rules.

Prefer MCP tools. Otherwise use \`node bin/rgr.cjs search\` or \`ask\`. Do not mutate the frozen
index.
`
}

function portableAdapterReadme(): string {
  return `# Adapter templates

The checked-in templates use \`<PORTABLE_ROOT>\` so the folder can be moved. After placing the
folder, generate a configuration containing the destination's real absolute path:

\`\`\`bash
node bin/configure.cjs --list
node bin/configure.cjs generic
node bin/configure.cjs openclaw
node bin/configure.cjs claude
node bin/configure.cjs codex
\`\`\`

Claude Code can register the generated server object directly:

\`\`\`bash
claude mcp add-json --scope local ragmir "$(node bin/configure.cjs claude)"
\`\`\`

Copy the Codex TOML into a trusted \`config.toml\` layer. Pass Kimi the JSON written by
\`node bin/configure.cjs kimi\`, and merge the OpenCode or Cline output into that tool's trusted MCP
configuration. Register the dedicated OpenClaw server object, then probe its local MCP connection:

\`\`\`bash
openclaw mcp set ragmir "$(node bin/configure.cjs openclaw)"
openclaw mcp doctor ragmir --probe
\`\`\`

Use \`generic\` for Hermes or another host that accepts a local stdio MCP server. n8n or a custom
service can invoke the read-only CLI with an argument array when MCP is not available. Do not
concatenate untrusted queries into a shell command.

Ragmir does not open an HTTP port. A network-facing host owns transport security, authentication,
authorization, rate limits, tool permissions, and action approvals.
`
}

function portableReadme(name: string, embeddingModelIncluded: boolean): string {
  const safeName = name.replaceAll("`", "'")
  const modelNote = embeddingModelIncluded
    ? "The local embedding model required by this index is included under `.ragmir/models/`."
    : "This index uses local-hash retrieval and needs no embedding-model download."
  return `# ${safeName}

This is a frozen Ragmir knowledge-base bundle. You can move the whole directory, verify it, then
connect a compatible agent or automation through MCP stdio or the read-only CLI. Raw source files
and access logs are not included. Indexed passages are included and remain sensitive.

${modelNote}

## Requirements

- Node.js 22 or later
- The same operating system and CPU architecture recorded in \`manifest.json\`

The runtime and its native retrieval dependencies are embedded in this folder. Querying it needs no
package-manager install, registry access, or source-project dependency. The launcher never uses an
absolute path from the export machine. Re-export the bundle on the destination platform when its
operating system or CPU architecture differs.

## Verify and query

\`\`\`bash
node bin/rgr.cjs portable verify . --json
node bin/rgr.cjs search "Which evidence governs this decision?" --compact --json
\`\`\`

The launcher blocks writer and repair commands. This folder is replaced, not updated, when the
source knowledge changes.

## Replace this bundle safely

When the authoritative source project can write this destination, export the next revision to the
same stable path with \`--replace\`:

\`\`\`bash
rgr portable export --output /absolute/stable/destination --replace
\`\`\`

Ragmir verifies the new export before switching the path and preserves this revision as a
timestamped sibling reported in \`previousOutputDir\`. Restart long-running consumers, verify the
stable path, and run a representative query before retiring that backup. For a remote destination,
transfer the new folder beside this one, verify it, stop or drain consumers, rename this folder to a
backup, rename the new folder to the stable path, then restart and verify again. Never delete the
active folder before its replacement is ready.

## Connect an agent

\`\`\`bash
node bin/configure.cjs --list
node bin/configure.cjs generic
\`\`\`

Copy the generated configuration into the trusted MCP configuration of the destination tool. See
\`adapters/README.md\` for Claude, Codex, Kimi, OpenCode, Cline, OpenClaw, Hermes, n8n, and custom
host guidance. Load \`skills/ragmir-portable\` for cited retrieval and
\`skills/ragmir-decision-evidence\` for evidence-grounded decisions.

## Security boundary

The knowledge base supplies evidence, not authority. The host owns credentials, network exposure,
authentication, authorization, rate limiting, external actions, and human approval. Check
\`manifest.json\` for the frozen export time and SHA-256 inventory before relying on the bundle.
`
}

async function verifyPortableTable(
  config: Config,
  tableName: string,
  expectedRows: number,
): Promise<void> {
  const connection = await connectStore(config)
  try {
    const table = await openRowsTableByName(tableName, config, connection)
    if (!table) {
      throw new Error(`Active LanceDB table is missing: ${tableName}.`)
    }
    try {
      const rows = await table.countRows()
      if (rows !== expectedRows) {
        throw new Error(`Active LanceDB table has ${rows} rows; expected ${expectedRows}.`)
      }
    } finally {
      closeRowsTable(table, config)
    }
  } finally {
    closeStoreConnection(connection, config)
  }
}

function assertPortableRuntimeConfig(config: Config, root: string): void {
  if (config.projectRoot !== root) {
    throw new Error("Portable config resolved to a different project root.")
  }
  const expectedPaths = {
    rawDir: path.join(root, ".ragmir", "source-unavailable"),
    storageDir: path.join(root, ".ragmir", "storage"),
    sourcesFile: path.join(root, ".ragmir", "sources.txt"),
    accessLogPath: path.join(root, ".ragmir", "access.log"),
    embeddingModelPath: path.join(root, ".ragmir", "models"),
  }
  for (const [key, expected] of Object.entries(expectedPaths)) {
    if (config[key as keyof typeof expectedPaths] !== expected) {
      throw new Error(`Portable config has an invalid ${key}.`)
    }
  }
  if (
    config.sources.length > 0 ||
    config.accessLog ||
    config.transformersAllowRemoteModels ||
    config.pdfOcrCommand.length > 0 ||
    config.imageOcrCommand.length > 0 ||
    config.legacyWordCommand.length > 0
  ) {
    throw new Error("Portable config enables a source, log, remote model, or external extractor.")
  }
}

async function writePrivateJson(filePath: string, value: unknown): Promise<void> {
  await writePrivateText(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

async function writePrivateText(filePath: string, contents: string): Promise<void> {
  await ensurePrivateDirectory(path.dirname(filePath))
  await writeFile(filePath, contents, { encoding: "utf8", mode: 0o600 })
  await hardenPrivateFile(filePath)
}

async function writeExecutable(filePath: string, contents: string): Promise<void> {
  await ensurePrivateDirectory(path.dirname(filePath))
  await writeFile(filePath, contents, { encoding: "utf8", mode: 0o700 })
  if (process.platform !== "win32") {
    await chmod(filePath, 0o700)
  }
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk)
  }
  return hash.digest("hex")
}

function portableRelativePath(value: string): string | null {
  if (value.includes("\\") || value.startsWith("/") || path.posix.isAbsolute(value)) {
    return null
  }
  const normalized = path.posix.normalize(value)
  if (normalized !== value || normalized === "." || normalized.startsWith("../")) {
    return null
  }
  return normalized
}

function pathContains(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  )
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath)
    return true
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false
    }
    throw error
  }
}

async function directoryExists(directory: string): Promise<boolean> {
  if (!existsSync(directory)) {
    return false
  }
  return (await lstat(directory)).isDirectory()
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

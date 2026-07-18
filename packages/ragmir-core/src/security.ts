import { execFile, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { externalExtractorsRequested, findProjectConfig, loadConfig } from "./config.js"
import {
  LEGACY_KB_DIR,
  LEGACY_KB_GITIGNORE_ENTRY,
  LEGACY_PRIVATE_DIR,
  LEGACY_PRIVATE_GITIGNORE_ENTRY,
  RAGMIR_GITIGNORE_ENTRY,
} from "./defaults.js"
import { operationSignal, throwIfAborted } from "./operation.js"
import type { Config, SecurityAuditOptions, SecurityAuditReport } from "./types.js"

export async function securityAudit(
  cwd = process.cwd(),
  options: SecurityAuditOptions = {},
): Promise<SecurityAuditReport> {
  const signal = operationSignal(options)
  throwIfAborted(signal)
  const config = await loadConfig(cwd)
  return securityAuditWithConfig(config, options)
}

export async function securityAuditWithConfig(
  config: Config,
  options: SecurityAuditOptions = {},
): Promise<SecurityAuditReport> {
  const signal = operationSignal(options)
  throwIfAborted(signal)
  const gitignore = await readGitignore(config.projectRoot, signal)
  throwIfAborted(signal)
  const warnings: string[] = []
  const probeGit = options.deep !== false
  const configPath = findProjectConfig(config.projectRoot).configPath
  const privatePathDefinitions = privatePathsForConfig(config, configPath)
  const gitPaths = [
    path.join(config.projectRoot, LEGACY_KB_GITIGNORE_ENTRY),
    path.join(config.projectRoot, RAGMIR_GITIGNORE_ENTRY),
    path.join(config.projectRoot, LEGACY_PRIVATE_GITIGNORE_ENTRY),
    config.storageDir,
    ...privatePathDefinitions.map((definition) => definition.filePath),
  ].map((filePath) => normalizeRelativePath(config.projectRoot, filePath))
  const [gitPathStates, permissions] = await Promise.all([
    inspectGitPaths(config.projectRoot, gitPaths, signal, probeGit),
    inspectPermissions(
      {
        configPath,
        rawDir: config.rawDir,
        storageDir: config.storageDir,
        sourcesFile: config.sourcesFile,
        accessLogPath: config.accessLogPath,
        embeddingModelPath: config.embeddingModelPath,
      },
      signal,
    ),
  ])
  throwIfAborted(signal)

  const usesLegacyKb = [config.storageDir, config.sourcesFile, config.accessLogPath].some(
    (filePath) => usesProjectDirectory(config.projectRoot, filePath, LEGACY_KB_DIR),
  )
  const usesLegacyPrivate = usesProjectDirectory(
    config.projectRoot,
    config.rawDir,
    LEGACY_PRIVATE_DIR,
  )
  const legacyKbIgnored = isPathIgnored(
    config.projectRoot,
    path.join(config.projectRoot, LEGACY_KB_GITIGNORE_ENTRY),
    gitignore,
    gitPathStates,
  )
  const ragmirIgnored = isPathIgnored(
    config.projectRoot,
    path.join(config.projectRoot, RAGMIR_GITIGNORE_ENTRY),
    gitignore,
    gitPathStates,
  )
  const legacyPrivateIgnored = isPathIgnored(
    config.projectRoot,
    path.join(config.projectRoot, LEGACY_PRIVATE_GITIGNORE_ENTRY),
    gitignore,
    gitPathStates,
  )
  const storageGitIgnored = isPathIgnored(
    config.projectRoot,
    config.storageDir,
    gitignore,
    gitPathStates,
  )
  const privatePaths = inspectPrivatePaths(
    config,
    privatePathDefinitions,
    permissions,
    gitignore,
    gitPathStates,
  )
  throwIfAborted(signal)

  if (
    config.privacyProfile !== "trusted" &&
    config.embeddingProvider === "transformers" &&
    config.transformersAllowRemoteModels
  ) {
    warnings.push(
      "Transformers remote model loading is enabled; model files can be downloaded from Hugging Face.",
    )
  }
  if (config.privacyProfile !== "trusted" && !config.redaction.enabled) {
    warnings.push("Redaction is disabled; secrets and identifiers may be embedded in the index.")
  }
  if (!ragmirIgnored) {
    warnings.push(`${RAGMIR_GITIGNORE_ENTRY} is not ignored by Git.`)
  }
  if (usesLegacyKb && !legacyKbIgnored) {
    warnings.push(`${LEGACY_KB_GITIGNORE_ENTRY} is not ignored by Git.`)
  }
  if (usesLegacyPrivate && !legacyPrivateIgnored) {
    warnings.push(`${LEGACY_PRIVATE_GITIGNORE_ENTRY} is not ignored by Git.`)
  }
  for (const privatePath of privatePaths) {
    const label = privatePathLabel(privatePath.kind)
    if (privatePath.insideProject && privatePath.gitIgnored === false) {
      warnings.push(`The ${label} is not ignored by Git.`)
    }
    if (privatePath.gitTracked === true) {
      warnings.push(`The ${label} is tracked by Git and may expose private Ragmir data.`)
    }
    if (privatePath.kind !== "access-log" || config.accessLog) {
      addPermissionWarning(warnings, privatePath.permissionPrivate, label)
    }
  }
  const enabledExternalExtractors = externalExtractorNames(config)
  const extractorsConfigured = externalExtractorsRequested(config)
  if (extractorsConfigured) {
    warnings.push(
      enabledExternalExtractors.length === 0 && config.privacyProfile === "strict"
        ? "External extractors were configured but are disabled by the strict privacy profile; they execute with operator authority when enabled."
        : "External extractors are configured and execute with the operator's filesystem and process authority.",
    )
  }

  throwIfAborted(signal)
  return {
    projectRoot: config.projectRoot,
    zeroTelemetry: true,
    privacyProfile: config.privacyProfile,
    retrievalProfile: config.retrievalProfile,
    providers: {
      embedding: config.embeddingProvider,
      embeddingModel: config.embeddingModel,
      embeddingModelRevision: config.embeddingModelRevision,
      embeddingModelDigest: config.embeddingModelDigest,
      embeddingModelPath: config.embeddingModelPath,
      transformersAllowRemoteModels: config.transformersAllowRemoteModels,
      llmGeneration: false,
    },
    redaction: {
      enabled: config.redaction.enabled,
      builtIn: config.redaction.builtIn,
      customPatterns: config.redaction.patterns.map((pattern) => pattern.name),
    },
    accessLog: {
      enabled: config.accessLog,
      path: config.accessLogPath,
      storesRawQueries: false,
    },
    storage: {
      path: config.storageDir,
      gitIgnored: storageGitIgnored,
      encryptedAtRest: "external-required",
    },
    privatePaths,
    externalExtractors: {
      configured: extractorsConfigured,
      enabled: enabledExternalExtractors,
      disabledByStrictProfile:
        extractorsConfigured &&
        config.privacyProfile === "strict" &&
        enabledExternalExtractors.length === 0,
      executeWithOperatorAuthority: true,
    },
    permissions,
    mcp: {
      maxTopK: config.mcpMaxTopK,
      maxOutputBytes: config.mcpMaxOutputBytes,
      destructiveToolsExposed: false,
    },
    gitignore: {
      legacyKbIgnored,
      ragmirIgnored,
      legacyPrivateIgnored,
    },
    recommendations: [
      "Run Ragmir inside an encrypted disk, VM, or container volume for at-rest encryption.",
      "Use npm provenance, release checksums, and the generated SBOM for release verification.",
      "Use one repository checkout per trust boundary; Ragmir does not implement multi-user RBAC.",
      "Use an external agent, MCP server, or local model runtime for LLM synthesis.",
    ],
    warnings,
  }
}

interface PermissionPaths {
  configPath: string
  rawDir: string
  storageDir: string
  sourcesFile: string
  accessLogPath: string
  embeddingModelPath: string
}

async function inspectPermissions(
  paths: PermissionPaths,
  signal: AbortSignal | undefined,
): Promise<SecurityAuditReport["permissions"]> {
  throwIfAborted(signal)
  if (process.platform === "win32") {
    return {
      checked: false,
      configPrivate: null,
      rawDirPrivate: null,
      storageDirPrivate: null,
      sourcesFilePrivate: null,
      accessLogPrivate: null,
      embeddingModelPathPrivate: null,
    }
  }
  const [
    configPrivate,
    rawDirPrivate,
    storageDirPrivate,
    sourcesFilePrivate,
    accessLogPrivate,
    embeddingModelPathPrivate,
  ] = await Promise.all([
    isPrivatePath(paths.configPath, signal),
    isPrivatePath(paths.rawDir, signal),
    isPrivatePath(paths.storageDir, signal),
    isPrivatePath(paths.sourcesFile, signal),
    isPrivatePath(paths.accessLogPath, signal),
    isPrivatePath(paths.embeddingModelPath, signal),
  ])
  throwIfAborted(signal)
  return {
    checked: true,
    configPrivate,
    rawDirPrivate,
    storageDirPrivate,
    sourcesFilePrivate,
    accessLogPrivate,
    embeddingModelPathPrivate,
  }
}

interface PrivatePathDefinition {
  kind: SecurityAuditReport["privatePaths"][number]["kind"]
  filePath: string
}

function privatePathsForConfig(config: Config, configPath: string): PrivatePathDefinition[] {
  return [
    {
      kind: "config",
      filePath: configPath,
    },
    { kind: "raw", filePath: config.rawDir },
    { kind: "storage", filePath: config.storageDir },
    { kind: "sources", filePath: config.sourcesFile },
    { kind: "access-log", filePath: config.accessLogPath },
    {
      kind: "embedding-models",
      filePath: config.embeddingModelPath,
    },
  ]
}

function inspectPrivatePaths(
  config: Config,
  definitions: PrivatePathDefinition[],
  permissions: SecurityAuditReport["permissions"],
  gitignore: Set<string>,
  gitPathStates: GitPathStates,
): SecurityAuditReport["privatePaths"] {
  return definitions.map((definition) => {
    const relativePath = normalizeRelativePath(config.projectRoot, definition.filePath)
    const insideProject = !isOutsideProject(relativePath)
    const gitState = gitPathStates.get(relativePath)
    return {
      kind: definition.kind,
      path: definition.filePath,
      insideProject,
      gitIgnored: insideProject
        ? isPathIgnored(config.projectRoot, definition.filePath, gitignore, gitPathStates)
        : null,
      gitTracked: insideProject ? (gitState?.tracked ?? null) : null,
      permissionPrivate: privatePathPermission(definition.kind, permissions),
    }
  })
}

function privatePathPermission(
  kind: PrivatePathDefinition["kind"],
  permissions: SecurityAuditReport["permissions"],
): boolean | null {
  switch (kind) {
    case "config":
      return permissions.configPrivate
    case "raw":
      return permissions.rawDirPrivate
    case "storage":
      return permissions.storageDirPrivate
    case "sources":
      return permissions.sourcesFilePrivate
    case "access-log":
      return permissions.accessLogPrivate
    case "embedding-models":
      return permissions.embeddingModelPathPrivate
  }
}

function privatePathLabel(kind: SecurityAuditReport["privatePaths"][number]["kind"]): string {
  switch (kind) {
    case "config":
      return "Ragmir config file"
    case "raw":
      return "configured rawDir"
    case "storage":
      return "configured storageDir"
    case "sources":
      return "configured sourcesFile"
    case "access-log":
      return "configured accessLogPath"
    case "embedding-models":
      return "configured embeddingModelPath"
  }
}

function externalExtractorNames(config: Config): Array<"pdf-ocr" | "image-ocr" | "legacy-word"> {
  const enabled: Array<"pdf-ocr" | "image-ocr" | "legacy-word"> = []
  if (config.pdfOcrCommand.length > 0) {
    enabled.push("pdf-ocr")
  }
  if (config.imageOcrCommand.length > 0) {
    enabled.push("image-ocr")
  }
  if (config.legacyWordCommand.length > 0) {
    enabled.push("legacy-word")
  }
  return enabled
}

async function isPrivatePath(
  filePath: string,
  signal: AbortSignal | undefined,
): Promise<boolean | null> {
  throwIfAborted(signal)
  try {
    const mode = (await stat(filePath)).mode & 0o777
    throwIfAborted(signal)
    return (mode & 0o077) === 0
  } catch (error) {
    throwIfAborted(signal)
    if (isNodeError(error) && error.code === "ENOENT") {
      return null
    }
    throw error
  }
}

function addPermissionWarning(
  warnings: string[],
  privatePath: boolean | null,
  label: string,
): void {
  if (privatePath === false) {
    warnings.push(
      `The ${label} is readable or writable by group/other users; restrict it to owner-only permissions or run \`rgr doctor --fix\` for Ragmir-owned default paths.`,
    )
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

async function readGitignore(
  projectRoot: string,
  signal: AbortSignal | undefined,
): Promise<Set<string>> {
  throwIfAborted(signal)
  const gitignorePath = path.join(projectRoot, ".gitignore")
  if (!existsSync(gitignorePath)) {
    return new Set()
  }

  let content: string
  try {
    content = await readFile(gitignorePath, { encoding: "utf8", signal })
  } catch (error) {
    throwIfAborted(signal)
    throw error
  }
  throwIfAborted(signal)
  return new Set(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  )
}

function usesProjectDirectory(projectRoot: string, filePath: string, directory: string): boolean {
  const relativePath = normalizeRelativePath(projectRoot, filePath)
  return relativePath === directory || relativePath.startsWith(`${directory}/`)
}

interface GitPathState {
  ignored: boolean | null
  tracked: boolean | null
}

type GitPathStates = ReadonlyMap<string, GitPathState>

interface SpawnedGitResult {
  code: number | null
  stdout: Buffer
}

async function inspectGitPaths(
  projectRoot: string,
  relativePaths: string[],
  signal: AbortSignal | undefined,
  probeGit: boolean,
): Promise<GitPathStates> {
  const paths = [
    ...new Set(relativePaths.filter((relativePath) => !isOutsideProject(relativePath))),
  ]
  if (!probeGit || paths.length === 0) {
    return new Map()
  }

  const [ignoredPaths, trackedPaths] = await Promise.all([
    checkGitIgnoredPaths(projectRoot, paths, signal),
    checkGitTrackedPaths(projectRoot, paths, signal),
  ])
  throwIfAborted(signal)
  return new Map(
    paths.map((relativePath) => [
      relativePath,
      {
        ignored: ignoredPaths?.get(relativePath) ?? null,
        tracked: trackedPaths?.get(relativePath) ?? null,
      },
    ]),
  )
}

function isPathIgnored(
  projectRoot: string,
  filePath: string,
  lines: Set<string>,
  gitPathStates: GitPathStates,
): boolean {
  const relativePath = normalizeRelativePath(projectRoot, filePath)
  if (isOutsideProject(relativePath)) {
    return false
  }

  const gitResult = gitPathStates.get(relativePath)?.ignored
  if (gitResult !== undefined && gitResult !== null) {
    return gitResult
  }

  return isPathIgnoredByEntries(relativePath, lines)
}

async function checkGitIgnoredPaths(
  projectRoot: string,
  relativePaths: string[],
  signal: AbortSignal | undefined,
): Promise<ReadonlyMap<string, boolean> | null> {
  const result = await spawnGitWithInput(
    projectRoot,
    ["check-ignore", "--verbose", "--non-matching", "-z", "--stdin"],
    Buffer.from(`${relativePaths.join("\0")}\0`, "utf8"),
    signal,
  )
  throwIfAborted(signal)
  if (!result || (result.code !== 0 && result.code !== 1)) {
    return null
  }

  const fields = nullDelimitedFields(result.stdout)
  if (fields.length % 4 !== 0) {
    return null
  }
  const ignoredPaths = new Map<string, boolean>()
  for (let index = 0; index < fields.length; index += 4) {
    const pattern = fields[index + 2]
    const relativePath = fields[index + 3]
    if (pattern === undefined || relativePath === undefined) {
      return null
    }
    ignoredPaths.set(relativePath, pattern.length > 0 && !pattern.startsWith("!"))
  }
  return relativePaths.every((relativePath) => ignoredPaths.has(relativePath)) ? ignoredPaths : null
}

function checkGitTrackedPaths(
  projectRoot: string,
  relativePaths: string[],
  signal: AbortSignal | undefined,
): Promise<ReadonlyMap<string, boolean> | null> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      [
        "ls-files",
        "--cached",
        "-z",
        "--",
        ...relativePaths.map((relativePath) => `:(literal)${relativePath}`),
      ],
      { cwd: projectRoot, encoding: "buffer", windowsHide: true, signal },
      (error, stdout) => {
        if (signal?.aborted) {
          reject(error)
          return
        }
        if (!error) {
          const trackedFiles = nullDelimitedFields(stdout)
          resolve(
            new Map(
              relativePaths.map((relativePath) => [
                relativePath,
                trackedFiles.some(
                  (trackedFile) =>
                    trackedFile === relativePath || trackedFile.startsWith(`${relativePath}/`),
                ),
              ]),
            ),
          )
          return
        }
        resolve(null)
      },
    )
  })
}

function spawnGitWithInput(
  projectRoot: string,
  args: string[],
  input: Buffer,
  signal: AbortSignal | undefined,
): Promise<SpawnedGitResult | null> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: projectRoot,
      signal,
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    })
    const stdout: Buffer[] = []
    let settled = false
    child.stdin.on("error", () => undefined)
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
    child.once("error", (error) => {
      if (settled) {
        return
      }
      settled = true
      if (signal?.aborted) {
        reject(error)
      } else {
        resolve(null)
      }
    })
    child.once("close", (code) => {
      if (settled) {
        return
      }
      settled = true
      resolve({ code, stdout: Buffer.concat(stdout) })
    })
    child.stdin.end(input)
  })
}

function nullDelimitedFields(output: Buffer): string[] {
  const fields = output.toString("utf8").split("\0")
  if (fields.at(-1) === "") {
    fields.pop()
  }
  return fields
}

function isPathIgnoredByEntries(relativePath: string, lines: Set<string>): boolean {
  const segments = relativePath.split("/")
  for (let index = 1; index <= segments.length; index += 1) {
    const prefix = segments.slice(0, index).join("/")
    if (lines.has(prefix) || lines.has(`${prefix}/`) || lines.has(`${prefix}/**`)) {
      return true
    }
  }
  return false
}

function isOutsideProject(relativePath: string): boolean {
  return relativePath === ".." || relativePath.startsWith("../") || path.isAbsolute(relativePath)
}

function normalizeRelativePath(projectRoot: string, filePath: string): string {
  return path.relative(projectRoot, filePath).split(path.sep).join("/")
}

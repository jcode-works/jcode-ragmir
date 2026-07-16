import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { findProjectConfig, loadConfig } from "./config.js"
import {
  LEGACY_KB_DIR,
  LEGACY_KB_GITIGNORE_ENTRY,
  LEGACY_PRIVATE_DIR,
  LEGACY_PRIVATE_GITIGNORE_ENTRY,
  RAGMIR_GITIGNORE_ENTRY,
} from "./defaults.js"
import { operationSignal, throwIfAborted } from "./operation.js"
import type { OperationOptions, SecurityAuditReport } from "./types.js"

export async function securityAudit(
  cwd = process.cwd(),
  options: OperationOptions = {},
): Promise<SecurityAuditReport> {
  const signal = operationSignal(options)
  throwIfAborted(signal)
  const config = await loadConfig(cwd)
  throwIfAborted(signal)
  const gitignore = await readGitignore(config.projectRoot, signal)
  throwIfAborted(signal)
  const warnings: string[] = []

  const usesLegacyKb = [config.storageDir, config.sourcesFile, config.accessLogPath].some(
    (filePath) => usesProjectDirectory(config.projectRoot, filePath, LEGACY_KB_DIR),
  )
  const usesLegacyPrivate = usesProjectDirectory(
    config.projectRoot,
    config.rawDir,
    LEGACY_PRIVATE_DIR,
  )
  const [
    legacyKbIgnored,
    ragmirIgnored,
    legacyPrivateIgnored,
    storageGitIgnored,
    accessLogGitIgnored,
  ] = await Promise.all([
    isPathIgnored(
      config.projectRoot,
      path.join(config.projectRoot, LEGACY_KB_GITIGNORE_ENTRY),
      gitignore,
      signal,
    ),
    isPathIgnored(
      config.projectRoot,
      path.join(config.projectRoot, RAGMIR_GITIGNORE_ENTRY),
      gitignore,
      signal,
    ),
    isPathIgnored(
      config.projectRoot,
      path.join(config.projectRoot, LEGACY_PRIVATE_GITIGNORE_ENTRY),
      gitignore,
      signal,
    ),
    isPathIgnored(config.projectRoot, config.storageDir, gitignore, signal),
    isPathIgnored(config.projectRoot, config.accessLogPath, gitignore, signal),
  ])
  throwIfAborted(signal)
  const permissions = await inspectPermissions(
    {
      configPath: findProjectConfig(cwd).configPath,
      rawDir: config.rawDir,
      storageDir: config.storageDir,
      accessLogPath: config.accessLogPath,
    },
    signal,
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
  if (!storageGitIgnored) {
    warnings.push("The configured storageDir is not ignored by Git.")
  }
  if (config.accessLog && !accessLogGitIgnored) {
    warnings.push("The configured accessLogPath is not ignored by Git.")
  }
  addPermissionWarning(warnings, permissions.configPrivate, "Ragmir config file")
  addPermissionWarning(warnings, permissions.rawDirPrivate, "raw document directory")
  addPermissionWarning(warnings, permissions.storageDirPrivate, "index storage directory")
  if (config.accessLog) {
    addPermissionWarning(warnings, permissions.accessLogPrivate, "access log")
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
  accessLogPath: string
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
      accessLogPrivate: null,
    }
  }
  const [configPrivate, rawDirPrivate, storageDirPrivate, accessLogPrivate] = await Promise.all([
    isPrivatePath(paths.configPath, signal),
    isPrivatePath(paths.rawDir, signal),
    isPrivatePath(paths.storageDir, signal),
    isPrivatePath(paths.accessLogPath, signal),
  ])
  throwIfAborted(signal)
  return {
    checked: true,
    configPrivate,
    rawDirPrivate,
    storageDirPrivate,
    accessLogPrivate,
  }
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

async function isPathIgnored(
  projectRoot: string,
  filePath: string,
  lines: Set<string>,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  throwIfAborted(signal)
  const relativePath = normalizeRelativePath(projectRoot, filePath)
  if (isOutsideProject(relativePath)) {
    return false
  }

  let gitResult: boolean | null
  try {
    gitResult = await checkGitIgnored(projectRoot, relativePath, signal)
  } catch (error) {
    throwIfAborted(signal)
    throw error
  }
  throwIfAborted(signal)
  if (gitResult !== null) {
    return gitResult
  }

  return isPathIgnoredByEntries(relativePath, lines)
}

function checkGitIgnored(
  projectRoot: string,
  relativePath: string,
  signal: AbortSignal | undefined,
): Promise<boolean | null> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["check-ignore", "--quiet", "--", relativePath],
      { cwd: projectRoot, windowsHide: true, signal },
      (error) => {
        if (!error) {
          resolve(true)
          return
        }
        if (signal?.aborted) {
          reject(error)
          return
        }
        if (error.code === 1) {
          resolve(false)
          return
        }
        resolve(null)
      },
    )
  })
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

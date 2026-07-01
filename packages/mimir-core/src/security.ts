import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { loadConfig } from "./config.js"
import {
  LEGACY_KB_DIR,
  LEGACY_KB_GITIGNORE_ENTRY,
  LEGACY_PRIVATE_DIR,
  LEGACY_PRIVATE_GITIGNORE_ENTRY,
  MIMIR_GITIGNORE_ENTRY,
} from "./defaults.js"
import type { SecurityAuditReport } from "./types.js"

export async function securityAudit(cwd = process.cwd()): Promise<SecurityAuditReport> {
  const config = await loadConfig(cwd)
  const gitignore = await readGitignore(config.projectRoot)
  const warnings: string[] = []

  const legacyKbIgnored = hasGitignoreEntry(gitignore, LEGACY_KB_GITIGNORE_ENTRY)
  const mimirIgnored = hasGitignoreEntry(gitignore, MIMIR_GITIGNORE_ENTRY)
  const legacyPrivateIgnored = hasGitignoreEntry(gitignore, LEGACY_PRIVATE_GITIGNORE_ENTRY)
  const usesLegacyKb = [config.storageDir, config.sourcesFile, config.accessLogPath].some(
    (filePath) => usesProjectDirectory(config.projectRoot, filePath, LEGACY_KB_DIR),
  )
  const usesLegacyPrivate = usesProjectDirectory(
    config.projectRoot,
    config.rawDir,
    LEGACY_PRIVATE_DIR,
  )
  const storageGitIgnored = isPathIgnored(config.projectRoot, config.storageDir, gitignore)

  if (config.embeddingProvider === "transformers" && config.transformersAllowRemoteModels) {
    warnings.push(
      "Transformers remote model loading is enabled; model files can be downloaded from Hugging Face.",
    )
  }
  if (!config.redaction.enabled) {
    warnings.push("Redaction is disabled; secrets and identifiers may be embedded in the index.")
  }
  if (!mimirIgnored) {
    warnings.push(`${MIMIR_GITIGNORE_ENTRY} is not ignored by Git.`)
  }
  if (usesLegacyKb && !legacyKbIgnored) {
    warnings.push(`${LEGACY_KB_GITIGNORE_ENTRY} is not ignored by Git.`)
  }
  if (usesLegacyPrivate && !legacyPrivateIgnored) {
    warnings.push(`${LEGACY_PRIVATE_GITIGNORE_ENTRY} is not ignored by Git.`)
  }

  return {
    projectRoot: config.projectRoot,
    zeroTelemetry: true,
    providers: {
      embedding: config.embeddingProvider,
      embeddingModel: config.embeddingModel,
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
    mcp: {
      maxTopK: config.mcpMaxTopK,
      destructiveToolsExposed: false,
    },
    gitignore: {
      legacyKbIgnored,
      mimirIgnored,
      legacyPrivateIgnored,
    },
    recommendations: [
      "Run Mimir inside an encrypted disk, VM, or container volume for at-rest encryption.",
      "Use npm provenance, release checksums, and the generated SBOM for release verification.",
      "Use one repository checkout per trust boundary; Mimir does not implement multi-user RBAC.",
      "Use an external agent, MCP server, or local model runtime for LLM synthesis.",
    ],
    warnings,
  }
}

async function readGitignore(projectRoot: string): Promise<Set<string>> {
  const gitignorePath = path.join(projectRoot, ".gitignore")
  if (!existsSync(gitignorePath)) {
    return new Set()
  }

  return new Set(
    (await readFile(gitignorePath, "utf8"))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  )
}

function hasGitignoreEntry(lines: Set<string>, entry: string): boolean {
  return lines.has(entry)
}

function usesProjectDirectory(projectRoot: string, filePath: string, directory: string): boolean {
  const relativePath = normalizeRelativePath(projectRoot, filePath)
  return relativePath === directory || relativePath.startsWith(`${directory}/`)
}

function isPathIgnored(projectRoot: string, filePath: string, lines: Set<string>): boolean {
  const relativePath = normalizeRelativePath(projectRoot, filePath)
  const segments = relativePath.split("/")
  for (let index = 1; index <= segments.length; index += 1) {
    const prefix = segments.slice(0, index).join("/")
    if (lines.has(prefix) || lines.has(`${prefix}/`) || lines.has(`${prefix}/**`)) {
      return true
    }
  }
  return false
}

function normalizeRelativePath(projectRoot: string, filePath: string): string {
  return path.relative(projectRoot, filePath).split(path.sep).join("/")
}

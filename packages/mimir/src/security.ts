import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { loadConfig } from "./config.js"
import { KB_GITIGNORE_ENTRY, MIMIR_GITIGNORE_ENTRY, PRIVATE_GITIGNORE_ENTRY } from "./defaults.js"
import type { SecurityAuditReport } from "./types.js"

export async function securityAudit(cwd = process.cwd()): Promise<SecurityAuditReport> {
  const config = await loadConfig(cwd)
  const gitignore = await readGitignore(config.projectRoot)
  const warnings: string[] = []

  const kbIgnored = hasGitignoreEntry(gitignore, KB_GITIGNORE_ENTRY)
  const mimirIgnored = hasGitignoreEntry(gitignore, MIMIR_GITIGNORE_ENTRY)
  const privateIgnored = hasGitignoreEntry(gitignore, PRIVATE_GITIGNORE_ENTRY)

  if (config.embeddingProvider === "transformers" && config.transformersAllowRemoteModels) {
    warnings.push(
      "Transformers remote model loading is enabled; model files can be downloaded from Hugging Face.",
    )
  }
  if (!config.redaction.enabled) {
    warnings.push("Redaction is disabled; secrets and identifiers may be embedded in the index.")
  }
  if (!kbIgnored) {
    warnings.push(`${KB_GITIGNORE_ENTRY} is not ignored by Git.`)
  }
  if (!mimirIgnored) {
    warnings.push(`${MIMIR_GITIGNORE_ENTRY} is not ignored by Git.`)
  }
  if (!privateIgnored) {
    warnings.push(`${PRIVATE_GITIGNORE_ENTRY} is not ignored by Git.`)
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
      gitIgnored: kbIgnored,
      encryptedAtRest: "external-required",
    },
    mcp: {
      maxTopK: config.mcpMaxTopK,
      destructiveToolsExposed: false,
    },
    gitignore: {
      kbIgnored,
      mimirIgnored,
      privateIgnored,
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

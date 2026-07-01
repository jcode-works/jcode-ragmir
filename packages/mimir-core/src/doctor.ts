import { existsSync } from "node:fs"
import path from "node:path"
import { findProjectConfig, loadConfig } from "./config.js"
import { MIMIR_DIR } from "./defaults.js"
import { audit } from "./ingest.js"
import { mimirCommand } from "./package-manager.js"
import { securityAudit } from "./security.js"
import { countRows } from "./store.js"
import type { DoctorReport } from "./types.js"

export async function doctor(cwd = process.cwd()): Promise<DoctorReport> {
  const projectConfig = findProjectConfig(cwd)
  const initialized = existsSync(projectConfig.configPath)
  const config = await loadConfig(cwd)
  const command = await mimirCommand(config.projectRoot, [])
  const agentKitInstalled = isAgentKitInstalled(config.projectRoot)
  const [auditReport, securityReport, chunksIndexed] = await Promise.all([
    audit(config.projectRoot),
    securityAudit(config.projectRoot),
    countRows(config),
  ])

  const nextSteps = nextActions({
    initialized,
    supportedFiles: auditReport.supportedFiles.length,
    skippedFiles: auditReport.skippedFiles.length,
    unsupportedFiles: auditReport.skippedFiles.filter(
      (file) => file.reason === "unsupported-extension",
    ).length,
    chunksIndexed,
    missingFromIndex: auditReport.missingFromIndex.length,
    staleInIndex: auditReport.staleInIndex.length,
    warnings: securityReport.warnings.length,
    embeddingProvider: config.embeddingProvider,
    agentKitInstalled,
    run: (args) => command.display + (args.length > 0 ? ` ${args.join(" ")}` : ""),
  })

  return {
    projectRoot: config.projectRoot,
    initialized,
    packageManager: command.packageManager,
    runCommand: command.display,
    agentKitInstalled,
    rawDir: config.rawDir,
    storageDir: config.storageDir,
    embeddingProvider: config.embeddingProvider,
    transformersAllowRemoteModels: config.transformersAllowRemoteModels,
    redactionEnabled: config.redaction.enabled,
    accessLog: config.accessLog,
    supportedFiles: auditReport.supportedFiles.length,
    skippedFiles: auditReport.skippedFiles.length,
    unsupportedFiles: auditReport.skippedFiles.filter(
      (file) => file.reason === "unsupported-extension",
    ).length,
    indexedFiles: auditReport.indexedFiles.length,
    chunksIndexed,
    missingFromIndex: auditReport.missingFromIndex.length,
    staleInIndex: auditReport.staleInIndex.length,
    securityWarnings: securityReport.warnings,
    ready:
      initialized &&
      chunksIndexed > 0 &&
      auditReport.missingFromIndex.length === 0 &&
      auditReport.staleInIndex.length === 0 &&
      securityReport.warnings.length === 0,
    nextSteps,
  }
}

interface NextActionInput {
  initialized: boolean
  supportedFiles: number
  skippedFiles: number
  unsupportedFiles: number
  chunksIndexed: number
  missingFromIndex: number
  staleInIndex: number
  warnings: number
  embeddingProvider: string
  agentKitInstalled: boolean
  run: (args: string[]) => string
}

function nextActions(input: NextActionInput): string[] {
  const steps: string[] = []

  if (!input.initialized) {
    steps.push(`Run \`${input.run(["setup"])}\` to initialize Mimir and install the agent kit.`)
    return steps
  }

  if (input.supportedFiles === 0) {
    if (input.skippedFiles > 0) {
      steps.push(
        "Mimir found files, but none are currently indexable. Run `mimir audit --unsupported` to inspect skipped files.",
      )
    } else {
      steps.push(
        "Add supported files under .mimir/raw/ or list extra source paths in .mimir/sources.txt.",
      )
    }
    return steps
  }

  if (input.chunksIndexed === 0 || input.missingFromIndex > 0 || input.staleInIndex > 0) {
    steps.push(`Run \`${input.run(["doctor", "--fix"])}\` to rebuild stale or missing index data.`)
    steps.push(`Run \`${input.run(["audit"])}\` to verify missingFromIndex=0 and staleInIndex=0.`)
    steps.push(
      "If files remain missing because they are scanned or image-only, configure `pdfOcrCommand` or `imageOcrCommand`, or convert scans/images to OCR text before ingesting.",
    )
  }

  if (input.warnings > 0) {
    steps.push(
      `Run \`${input.run(["security-audit", "--strict"])}\` and fix the reported warnings.`,
    )
  }

  if (steps.length === 0) {
    if (input.unsupportedFiles > 0) {
      steps.push(
        "Run `mimir audit --unsupported` to inspect files skipped because their type is not supported.",
      )
    }
    if (input.embeddingProvider === "local-hash") {
      steps.push(
        `For natural-language Q&A, run \`${input.run(["models", "pull", "--enable"])}\`, then run \`${input.run(["ingest", "--rebuild"])}\`.`,
      )
    }
    steps.push(`Run \`${input.run(["search", '"your question"'])}\` to retrieve source passages.`)
    steps.push(
      `Run \`${input.run(["ask", '"your question"'])}\` to produce cited retrieval context.`,
    )
    steps.push(
      `Run \`${input.run(["research", '"your topic"'])}\` for audit-backed multi-query evidence.`,
    )
    if (input.agentKitInstalled) {
      steps.push(
        "Run `mimir install-agent --agents claude` or another targeted agent list for native skill discovery.",
      )
      steps.push(
        "Wire the matching MCP helper from .mimir/ when the agent should call Mimir tools directly.",
      )
    } else {
      steps.push(
        `Run \`${input.run(["install-skill"])}\` if an AI agent should use the local knowledge base.`,
      )
    }
  }

  return steps
}

function isAgentKitInstalled(projectRoot: string): boolean {
  const requiredPaths = [
    path.join(projectRoot, MIMIR_DIR, "skills", "mimir", "SKILL.md"),
    path.join(projectRoot, MIMIR_DIR, "skills", "mimir-audio-summary", "SKILL.md"),
    path.join(projectRoot, MIMIR_DIR, "skills", "mimir-markdown-report", "SKILL.md"),
    path.join(projectRoot, MIMIR_DIR, "mcp.json"),
    path.join(projectRoot, MIMIR_DIR, "agent-setup.md"),
  ]
  const agentHelpers = [
    path.join(projectRoot, MIMIR_DIR, "claude-mcp-server.json"),
    path.join(projectRoot, MIMIR_DIR, "codex-mcp.toml"),
    path.join(projectRoot, MIMIR_DIR, "kimi-mcp.json"),
    path.join(projectRoot, MIMIR_DIR, "opencode.jsonc"),
    path.join(projectRoot, MIMIR_DIR, "cline-mcp.json"),
  ]
  return (
    requiredPaths.every((requiredPath) => existsSync(requiredPath)) &&
    agentHelpers.some((helperPath) => existsSync(helperPath))
  )
}

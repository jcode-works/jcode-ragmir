import { existsSync } from "node:fs"
import path from "node:path"
import { findProjectConfig, loadConfig } from "./config.js"
import { RAGMIR_DIR } from "./defaults.js"
import { countSkippedByReason } from "./files.js"
import { getIndexFreshnessWarning, getLexicalScanWarning } from "./index-diagnostics.js"
import { audit } from "./ingest.js"
import { ragmirCommand } from "./package-manager.js"
import { securityAudit } from "./security.js"
import {
  AGENT_HELPER_CONFIG_FILENAMES,
  AGENT_SETUP_FILENAME,
  MCP_CONFIG_FILENAME,
  SKILL_NAMES,
} from "./skill.js"
import { countRows, readIndexManifest } from "./store.js"
import type { DoctorReport } from "./types.js"

export async function doctor(cwd = process.cwd()): Promise<DoctorReport> {
  const projectConfig = findProjectConfig(cwd)
  const initialized = existsSync(projectConfig.configPath)
  const config = await loadConfig(cwd)
  const command = await ragmirCommand(config.projectRoot, [])
  const agentKitInstalled = isAgentKitInstalled(config.projectRoot)
  const [auditReport, securityReport, chunksIndexed, manifest, freshnessWarning] =
    await Promise.all([
      audit(config.projectRoot),
      securityAudit(config.projectRoot),
      countRows(config),
      readIndexManifest(config),
      getIndexFreshnessWarning(config),
    ])

  const lexicalScanWarning = chunksIndexed > 0 ? getLexicalScanWarning(config, chunksIndexed) : null
  const indexFreshness = {
    manifestFound: manifest !== null,
    warning: freshnessWarning,
  }

  const nextSteps = nextActions({
    initialized,
    supportedFiles: auditReport.supportedFiles.length,
    skippedFiles: auditReport.skippedFiles.length,
    unsupportedFiles: countSkippedByReason(auditReport.skippedFiles, "unsupported-extension"),
    chunksIndexed,
    missingFromIndex: auditReport.missingFromIndex.length,
    staleInIndex: auditReport.staleInIndex.length,
    warnings: securityReport.warnings.length,
    embeddingProvider: config.embeddingProvider,
    agentKitInstalled,
    freshnessWarning,
    lexicalScanWarning,
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
    unsupportedFiles: countSkippedByReason(auditReport.skippedFiles, "unsupported-extension"),
    indexedFiles: auditReport.indexedFiles.length,
    chunksIndexed,
    missingFromIndex: auditReport.missingFromIndex.length,
    staleInIndex: auditReport.staleInIndex.length,
    securityWarnings: securityReport.warnings,
    indexFreshness,
    ready:
      initialized &&
      chunksIndexed > 0 &&
      auditReport.missingFromIndex.length === 0 &&
      auditReport.staleInIndex.length === 0 &&
      securityReport.warnings.length === 0 &&
      freshnessWarning === null,
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
  freshnessWarning: string | null
  lexicalScanWarning: string | null
  run: (args: string[]) => string
}

function nextActions(input: NextActionInput): string[] {
  const steps: string[] = []

  if (!input.initialized) {
    steps.push(`Run \`${input.run(["setup"])}\` to initialize Ragmir and install the agent kit.`)
    return steps
  }

  if (input.supportedFiles === 0) {
    if (input.skippedFiles > 0) {
      steps.push(
        "Ragmir found files, but none are currently indexable. Run `ragmir audit --unsupported` to inspect skipped files.",
      )
    } else {
      steps.push(
        'Add supported files under .ragmir/raw/ or list extra source paths in the "sources" array of .ragmir/config.json.',
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

  if (input.freshnessWarning) {
    steps.push(
      `${input.freshnessWarning.replace(/`/g, "\\`")} Run \`${input.run(["ingest", "--rebuild"])}\` to align the index with the active configuration.`,
    )
  }

  if (input.lexicalScanWarning) {
    steps.push(input.lexicalScanWarning)
  }

  if (input.warnings > 0) {
    steps.push(
      `Run \`${input.run(["security-audit", "--strict"])}\` and fix the reported warnings.`,
    )
  }

  if (steps.length === 0) {
    if (input.unsupportedFiles > 0) {
      steps.push(
        "Run `ragmir audit --unsupported` to inspect files skipped because their type is not supported.",
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
        "Run `ragmir install-agent --agents claude` or another targeted agent list for native skill discovery.",
      )
      steps.push(
        "Wire the matching MCP helper from .ragmir/ when the agent should call Ragmir tools directly.",
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
  const ragmirDir = path.join(projectRoot, RAGMIR_DIR)
  const requiredPaths = [
    ...SKILL_NAMES.map((skillName) => path.join(ragmirDir, "skills", skillName, "SKILL.md")),
    path.join(ragmirDir, MCP_CONFIG_FILENAME),
    path.join(ragmirDir, AGENT_SETUP_FILENAME),
  ]
  const agentHelpers = Object.values(AGENT_HELPER_CONFIG_FILENAMES).map((filename) =>
    path.join(ragmirDir, filename),
  )
  return (
    requiredPaths.every((requiredPath) => existsSync(requiredPath)) &&
    agentHelpers.some((helperPath) => existsSync(helperPath))
  )
}

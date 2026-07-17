import { existsSync } from "node:fs"
import path from "node:path"
import { findProjectConfig, loadConfig } from "./config.js"
import { RAGMIR_DIR } from "./defaults.js"
import { countSkippedByReason } from "./files.js"
import { getIndexFreshnessWarning, getLexicalScanWarning } from "./index-diagnostics.js"
import { audit } from "./ingest.js"
import { operationSignal, throwIfAborted } from "./operation.js"
import { RGR_RUNNER_FILENAME, rgrCommand } from "./package-manager.js"
import { isCompatibleQualityReport } from "./quality-report.js"
import { securityAudit } from "./security.js"
import {
  AGENT_HELPER_CONFIG_FILENAMES,
  AGENT_SETUP_FILENAME,
  inspectAgentIntegration,
  MCP_CONFIG_FILENAME,
  SKILL_NAMES,
} from "./skill.js"
import { countRows, readIndexManifest } from "./store.js"
import type { DoctorReport, OperationOptions } from "./types.js"

export async function doctor(
  cwd = process.cwd(),
  options: OperationOptions = {},
): Promise<DoctorReport> {
  const signal = operationSignal(options)
  throwIfAborted(signal)
  const projectConfig = findProjectConfig(cwd)
  const initialized = existsSync(projectConfig.configPath)
  const config = await loadConfig(cwd)
  throwIfAborted(signal)
  const command = await rgrCommand(config.projectRoot, [])
  throwIfAborted(signal)
  const agentKitInstalled = isAgentKitInstalled(config.projectRoot)
  const agentIntegration = inspectAgentIntegration(config.projectRoot)
  const operationOptions = signal ? { signal } : {}
  const [auditReport, securityReport, chunksIndexed, manifest, freshnessWarning] =
    await Promise.all([
      audit(config.projectRoot, operationOptions),
      securityAudit(config.projectRoot, operationOptions),
      countRows(config),
      readIndexManifest(config),
      getIndexFreshnessWarning(config),
    ])
  throwIfAborted(signal)

  const lexicalScanWarning = chunksIndexed > 0 ? getLexicalScanWarning(config, chunksIndexed) : null
  const indexFreshness = {
    manifestFound: manifest !== null,
    warning: freshnessWarning,
  }
  const oversizedFiles = countSkippedByReason(auditReport.skippedFiles, "oversized")
  const sensitiveFiles = countSkippedByReason(auditReport.skippedFiles, "sensitive-name")
  const coverageComplete =
    auditReport.missingFromIndex.length === 0 &&
    auditReport.staleInIndex.length === 0 &&
    auditReport.emptyTextFiles.length === 0 &&
    oversizedFiles === 0
  const operationalReady = initialized && chunksIndexed > 0 && coverageComplete
  const indexPolicyCurrent = freshnessWarning === null
  const privacyCompliant = securityReport.warnings.length === 0
  const retrievalQualityVerified = await isCompatibleQualityReport(
    manifest?.qualityReport,
    manifest,
    config,
  )
  throwIfAborted(signal)

  const nextSteps = nextActions({
    initialized,
    supportedFiles: auditReport.supportedFiles.length,
    supportedBytes: auditReport.supportedBytes,
    largestFileBytes: auditReport.largestFileBytes,
    skippedFiles: auditReport.skippedFiles.length,
    unsupportedFiles: countSkippedByReason(auditReport.skippedFiles, "unsupported-extension"),
    chunksIndexed,
    missingFromIndex: auditReport.missingFromIndex.length,
    staleInIndex: auditReport.staleInIndex.length,
    emptyTextFiles: auditReport.emptyTextFiles.length,
    oversizedFiles,
    sensitiveFiles,
    warnings: securityReport.warnings.length,
    embeddingProvider: config.embeddingProvider,
    agentKitInstalled,
    agentRunnerReady: agentIntegration.runnerReady,
    nativeAgentCount: agentIntegration.nativeAgents.length,
    freshnessWarning,
    lexicalScanWarning,
    run: (args) => command.display + (args.length > 0 ? ` ${args.join(" ")}` : ""),
  })

  throwIfAborted(signal)
  return {
    projectRoot: config.projectRoot,
    initialized,
    packageManager: command.packageManager,
    runCommand: command.display,
    agentKitInstalled,
    agentIntegration,
    rawDir: config.rawDir,
    storageDir: config.storageDir,
    embeddingProvider: config.embeddingProvider,
    transformersAllowRemoteModels: config.transformersAllowRemoteModels,
    redactionEnabled: config.redaction.enabled,
    accessLog: config.accessLog,
    privacyProfile: config.privacyProfile,
    retrievalProfile: config.retrievalProfile,
    supportedFiles: auditReport.supportedFiles.length,
    supportedBytes: auditReport.supportedBytes,
    largestFileBytes: auditReport.largestFileBytes,
    maxFileBytes: config.maxFileBytes,
    skippedFiles: auditReport.skippedFiles.length,
    unsupportedFiles: countSkippedByReason(auditReport.skippedFiles, "unsupported-extension"),
    oversizedFiles,
    sensitiveFiles,
    emptyTextFiles: auditReport.emptyTextFiles.length,
    indexedFiles: auditReport.indexedFiles.length,
    chunksIndexed,
    missingFromIndex: auditReport.missingFromIndex.length,
    staleInIndex: auditReport.staleInIndex.length,
    securityWarnings: securityReport.warnings,
    indexFreshness,
    ready: operationalReady && indexPolicyCurrent && privacyCompliant,
    readiness: {
      operationalReady,
      coverageComplete,
      indexPolicyCurrent,
      privacyCompliant,
      retrievalQualityVerified,
      acceptedRisks: config.acceptedRisks,
    },
    nextSteps,
  }
}

interface NextActionInput {
  initialized: boolean
  supportedFiles: number
  supportedBytes: number
  largestFileBytes: number
  skippedFiles: number
  unsupportedFiles: number
  oversizedFiles: number
  sensitiveFiles: number
  chunksIndexed: number
  missingFromIndex: number
  staleInIndex: number
  emptyTextFiles: number
  warnings: number
  embeddingProvider: string
  agentKitInstalled: boolean
  agentRunnerReady: boolean
  nativeAgentCount: number
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
        "Ragmir found files, but none are currently indexable. Run `rgr audit --unsupported` to inspect skipped files.",
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
      `${input.freshnessWarning} Run \`${input.run(["ingest", "--rebuild"])}\` to align the index with the active configuration.`,
    )
  }

  if (input.lexicalScanWarning) {
    steps.push(input.lexicalScanWarning)
  }

  if (input.emptyTextFiles > 0) {
    steps.push(
      `${input.emptyTextFiles} supported source file(s) produced no indexable text. Configure local OCR for scans/images, convert the files, or add extracted text, then re-ingest.`,
    )
  }

  if (input.oversizedFiles > 0) {
    steps.push(
      `${input.oversizedFiles} source file(s) exceed maxFileBytes. Run \`rgr audit --unsupported\`, then split the files or raise the limit only after reviewing the memory and parsing risk.`,
    )
  }

  if (input.unsupportedFiles > 0 || input.sensitiveFiles > 0) {
    steps.push("Run `rgr audit --unsupported` to review every intentionally skipped source file.")
  }

  if (input.warnings > 0) {
    steps.push(
      `Run \`${input.run(["security-audit", "--strict"])}\` and fix the reported warnings.`,
    )
  }

  if (steps.length === 0) {
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
    if (input.agentKitInstalled && input.nativeAgentCount > 0) {
      steps.push(
        "Restart or reload the selected agents so they discover the installed Ragmir skills.",
      )
      if (!input.agentRunnerReady) {
        steps.push(
          "Install @jcode.labs/ragmir in this project or rebuild the workspace package, then rerun `rgr doctor` to verify the local runner.",
        )
      }
      steps.push(
        "Wire the matching MCP helper from .ragmir/ when the agent should call Ragmir tools directly.",
      )
    } else if (input.agentKitInstalled) {
      steps.push(
        "Run `rgr install-agent --agents claude` or another targeted agent list, then rerun `rgr doctor`.",
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
    path.join(ragmirDir, RGR_RUNNER_FILENAME),
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

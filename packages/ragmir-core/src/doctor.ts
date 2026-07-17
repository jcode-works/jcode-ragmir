import { existsSync } from "node:fs"
import path from "node:path"
import { findProjectConfig, loadConfig } from "./config.js"
import { RAGMIR_DIR } from "./defaults.js"
import { countSkippedByReason } from "./files.js"
import { getLexicalScanWarning, indexFreshnessWarning } from "./index-diagnostics.js"
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
import { readIndexManifest, readIndexManifestHeader } from "./store.js"
import type { DoctorOptions, DoctorReport } from "./types.js"

export async function doctor(
  cwd = process.cwd(),
  options: DoctorOptions = {},
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
  const deep = options.deep === true
  const [auditReport, securityReport, manifest] = deep
    ? await Promise.all([
        audit(config.projectRoot, operationOptions),
        securityAudit(config.projectRoot, operationOptions),
        readIndexManifest(config),
      ])
    : [null, null, await readIndexManifestHeader(config)]
  throwIfAborted(signal)

  const health = manifest?.health
  const supportedFiles = auditReport?.supportedFiles.length ?? health?.supportedFiles ?? 0
  const supportedBytes = auditReport?.supportedBytes ?? health?.supportedBytes ?? 0
  const largestFileBytes = auditReport?.largestFileBytes ?? health?.largestFileBytes ?? 0
  const skippedFiles = auditReport?.skippedFiles.length ?? health?.skippedFiles ?? 0
  const unsupportedFiles = auditReport
    ? countSkippedByReason(auditReport.skippedFiles, "unsupported-extension")
    : (health?.unsupportedFiles ?? 0)
  const oversizedFiles = auditReport
    ? countSkippedByReason(auditReport.skippedFiles, "oversized")
    : (health?.oversizedFiles ?? 0)
  const sensitiveFiles = auditReport
    ? countSkippedByReason(auditReport.skippedFiles, "sensitive-name")
    : (health?.sensitiveFiles ?? 0)
  const emptyTextFiles = auditReport?.emptyTextFiles.length ?? health?.emptyTextFiles ?? 0
  const indexedFiles = auditReport?.indexedFiles.length ?? manifest?.fileCount ?? 0
  const chunksIndexed = auditReport?.totalChunks ?? manifest?.chunkCount ?? 0
  const missingFromIndex = auditReport?.missingFromIndex.length ?? health?.missingFromIndex ?? 0
  const staleInIndex = auditReport?.staleInIndex.length ?? health?.staleInIndex ?? 0
  const securityWarnings = securityReport?.warnings ?? health?.securityWarnings ?? []
  const freshnessWarning = indexFreshnessWarning(config, manifest)
  const lexicalScanWarning = chunksIndexed > 0 ? getLexicalScanWarning(config, chunksIndexed) : null
  const indexFreshness = {
    manifestFound: manifest !== null,
    warning: freshnessWarning,
  }
  const diagnosticSnapshotAvailable = deep || health !== undefined
  const coverageComplete =
    diagnosticSnapshotAvailable &&
    missingFromIndex === 0 &&
    staleInIndex === 0 &&
    emptyTextFiles === 0 &&
    oversizedFiles === 0
  const operationalReady = initialized && manifest !== null && chunksIndexed > 0 && coverageComplete
  const indexPolicyCurrent = manifest !== null && freshnessWarning === null
  const privacyCompliant = diagnosticSnapshotAvailable && securityWarnings.length === 0
  const retrievalQualityVerified = deep
    ? await isCompatibleQualityReport(manifest?.qualityReport, manifest, config)
    : false
  throwIfAborted(signal)

  const nextSteps = nextActions({
    initialized,
    diagnosticSnapshotAvailable,
    supportedFiles,
    supportedBytes,
    largestFileBytes,
    skippedFiles,
    unsupportedFiles,
    chunksIndexed,
    missingFromIndex,
    staleInIndex,
    emptyTextFiles,
    oversizedFiles,
    sensitiveFiles,
    warnings: securityWarnings.length,
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
    mode: deep ? "deep" : "manifest",
    inventoryVerified: deep,
    securityVerified: deep,
    cost: deep ? "O(corpus)" : "O(1)",
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
    supportedFiles,
    supportedBytes,
    largestFileBytes,
    maxFileBytes: config.maxFileBytes,
    skippedFiles,
    unsupportedFiles,
    oversizedFiles,
    sensitiveFiles,
    emptyTextFiles,
    indexedFiles,
    chunksIndexed,
    missingFromIndex,
    staleInIndex,
    securityWarnings,
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
  diagnosticSnapshotAvailable: boolean
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

  if (!input.diagnosticSnapshotAvailable) {
    steps.push(
      `Run \`${input.run(["doctor", "--deep"])}\` for an O(corpus) source and security audit.`,
    )
    steps.push(
      `Run \`${input.run(["ingest"])}\` to create a current manifest before relying on status or search.`,
    )
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

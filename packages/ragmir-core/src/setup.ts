import path from "node:path"
import { loadConfig } from "./config.js"
import { doctor } from "./doctor.js"
import { type PullEmbeddingModelResult, pullEmbeddingModel } from "./embeddings.js"
import { ingest } from "./ingest.js"
import { initProject } from "./init.js"
import { type PackageManager, rgrCommand } from "./package-manager.js"
import { type EnableSemanticEmbeddingsResult, enableSemanticEmbeddings } from "./semantic-config.js"
import { RAGMIR_SETUP_PROMPT } from "./setup-prompt.js"
import {
  type AgentSkillInstallation,
  type AgentTarget,
  type InstallAgentSkillsOptions,
  type InstallSkillResult,
  installAgentSkills,
} from "./skill.js"
import type { DoctorReport, IngestResult } from "./types.js"

export interface SetupOptions {
  cwd?: string
  targetDir?: string
  ingest?: boolean
  semantic?: boolean
  agents?: readonly AgentTarget[]
  mcpServerName?: string
  mcpCommand?: string
  mcpArgs?: readonly string[]
  forceAgentSkills?: boolean
}

export interface SetupSemanticResult {
  model: PullEmbeddingModelResult
  config: EnableSemanticEmbeddingsResult
}

export interface SetupResult {
  projectRoot: string
  packageManager: PackageManager
  runCommand: string
  created: string[]
  agentKit: InstallSkillResult
  agentInstallations: AgentSkillInstallation[]
  semantic: SetupSemanticResult | null
  ingested: IngestResult | null
  doctor: DoctorReport
  nextSteps: string[]
  configurationPrompt: string
}

export async function setupProject(options: SetupOptions = {}): Promise<SetupResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const created = await initProject(cwd)
  const installOptions: InstallAgentSkillsOptions = { cwd, scope: "project", mode: "link" }
  if (options.targetDir !== undefined) {
    installOptions.targetDir = options.targetDir
  }
  if (options.agents !== undefined) {
    installOptions.agents = options.agents
  }
  if (options.mcpServerName !== undefined) {
    installOptions.mcpServerName = options.mcpServerName
  }
  if (options.mcpCommand !== undefined) {
    installOptions.mcpCommand = options.mcpCommand
  }
  if (options.mcpArgs !== undefined) {
    installOptions.mcpArgs = options.mcpArgs
  }
  if (options.forceAgentSkills !== undefined) {
    installOptions.force = options.forceAgentSkills
  }
  const agentSkills = await installAgentSkills(installOptions)
  const agentKit = agentSkills.projectKit
  const semantic = options.semantic ? await setupSemanticEmbeddings(cwd) : null
  let report = await doctor(cwd, { deep: true })
  let ingested: IngestResult | null = null

  if (options.ingest !== false && canAutoIngest(report)) {
    ingested = await ingest({ cwd })
    report = await doctor(cwd, { deep: true })
  }

  const command = await rgrCommand(cwd, ["doctor"])

  return {
    projectRoot: report.projectRoot,
    packageManager: command.packageManager,
    runCommand: command.display,
    created,
    agentKit,
    agentInstallations: agentSkills.installations,
    semantic,
    ingested,
    doctor: report,
    nextSteps: setupNextSteps(report),
    configurationPrompt: RAGMIR_SETUP_PROMPT,
  }
}

async function setupSemanticEmbeddings(cwd: string): Promise<SetupSemanticResult> {
  const config = await loadConfig(cwd)
  const model = await pullEmbeddingModel(config)
  const semanticConfig = await enableSemanticEmbeddings(cwd, {
    embeddingModelRevision: model.embeddingModelRevision,
    embeddingModelDigest: model.embeddingModelDigest,
  })
  return {
    model,
    config: semanticConfig,
  }
}

function canAutoIngest(report: DoctorReport): boolean {
  return (
    report.supportedFiles > 0 &&
    report.securityWarnings.length === 0 &&
    (report.chunksIndexed === 0 ||
      report.missingFromIndex > 0 ||
      report.staleInIndex > 0 ||
      !report.readiness.indexPolicyCurrent)
  )
}

function setupNextSteps(report: DoctorReport): string[] {
  if (report.ready) {
    return [
      "Ask questions with the search or ask command shown by `rgr doctor`.",
      "Restart or reload the selected agents so they discover the installed Ragmir skills.",
      "Wire the matching MCP helper from .ragmir/ when the agent should call Ragmir tools directly.",
    ]
  }
  return report.nextSteps
}

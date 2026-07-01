import path from "node:path"
import { doctor } from "./doctor.js"
import { ingest } from "./ingest.js"
import { initProject } from "./init.js"
import { mimirCommand, type PackageManager } from "./package-manager.js"
import { type AgentTarget, type InstallSkillResult, installSkill } from "./skill.js"
import type { DoctorReport, IngestResult } from "./types.js"

export interface SetupOptions {
  cwd?: string
  targetDir?: string
  ingest?: boolean
  agents?: readonly AgentTarget[]
  mcpServerName?: string
  mcpCommand?: string
  mcpArgs?: readonly string[]
}

export interface SetupResult {
  projectRoot: string
  packageManager: PackageManager
  runCommand: string
  created: string[]
  agentKit: InstallSkillResult
  ingested: IngestResult | null
  doctor: DoctorReport
  nextSteps: string[]
}

export async function setupProject(options: SetupOptions = {}): Promise<SetupResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const created = await initProject(cwd)
  const installOptions: Parameters<typeof installSkill>[0] = { cwd }
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
  const agentKit = await installSkill(installOptions)
  let report = await doctor(cwd)
  let ingested: IngestResult | null = null

  if (options.ingest !== false && canAutoIngest(report)) {
    ingested = await ingest({ cwd })
    report = await doctor(cwd)
  }

  const command = await mimirCommand(cwd, ["doctor"])

  return {
    projectRoot: report.projectRoot,
    packageManager: command.packageManager,
    runCommand: command.display,
    created,
    agentKit,
    ingested,
    doctor: report,
    nextSteps: setupNextSteps(report),
  }
}

function canAutoIngest(report: DoctorReport): boolean {
  return (
    report.supportedFiles > 0 &&
    report.securityWarnings.length === 0 &&
    (report.chunksIndexed === 0 || report.missingFromIndex > 0 || report.staleInIndex > 0)
  )
}

function setupNextSteps(report: DoctorReport): string[] {
  if (report.ready) {
    return [
      "Ask questions with the search or ask command shown by `mimir doctor`.",
      "Run `mimir install-agent --agents claude` or another targeted agent list for native skill discovery.",
      "Wire the matching MCP helper from .mimir/ when the agent should call Mimir tools directly.",
    ]
  }
  return report.nextSteps
}

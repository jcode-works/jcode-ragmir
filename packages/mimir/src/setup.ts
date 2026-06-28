import path from "node:path"
import { doctor } from "./doctor.js"
import { ingest } from "./ingest.js"
import { initProject } from "./init.js"
import { kbCommand, type PackageManager } from "./package-manager.js"
import { type InstallSkillResult, installSkill } from "./skill.js"
import type { DoctorReport, IngestResult } from "./types.js"

export interface SetupOptions {
  cwd?: string
  targetDir?: string
  ingest?: boolean
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
  const agentKit = await installSkill(installOptions)
  let report = await doctor(cwd)
  let ingested: IngestResult | null = null

  if (options.ingest !== false && canAutoIngest(report)) {
    ingested = await ingest({ cwd, rebuild: true })
    report = await doctor(cwd)
  }

  const command = await kbCommand(cwd, ["doctor"])

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
      "Ask questions with the search or ask command shown by `kb doctor`.",
      "Connect an AI with .mimir/mcp.json or load .mimir/skills/mimir/.",
    ]
  }
  return report.nextSteps
}

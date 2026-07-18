import { loadConfig } from "./config.js"
import { doctor } from "./doctor.js"
import { getIngestionProgress } from "./ingestion-state.js"
import { type SetupOptions, setupProject } from "./setup.js"
import { readIndexManifestHeader } from "./store.js"
import type { DoctorReport, IngestionRunMode, IngestResult } from "./types.js"
import { VERSION } from "./version.js"

export type UpgradeStatus = "current" | "index-required" | "rebuild-required" | "repair-required"

export interface UpgradeInspection {
  status: UpgradeStatus
  runtimeRagmirVersion: string
  indexedWithRagmirVersion: string | null
  ready: boolean
  privacyCompliant: boolean
  advisories: string[]
  reason: string | null
  recommendedCommand: "rgr upgrade"
  safeActivation: boolean
}

export interface UpgradeResult extends UpgradeInspection {
  action: "none" | "indexed" | "rebuilt"
  previousIndexedWithRagmirVersion: string | null
  previousIndexKeptUntilActivation: boolean
  doctor: DoctorReport
}

export interface UpgradeOptions {
  cwd?: string
  agents?: SetupOptions["agents"]
  forceAgentSkills?: boolean
}

export async function inspectUpgrade(cwd = process.cwd()): Promise<UpgradeInspection> {
  const config = await loadConfig(cwd)
  const [report, manifest] = await Promise.all([
    doctor(config.projectRoot),
    readIndexManifestHeader(config),
  ])
  const status = upgradeStatus(report, manifest !== null)
  return {
    status,
    runtimeRagmirVersion: VERSION,
    indexedWithRagmirVersion: manifest?.ragmirVersion ?? null,
    ready: status === "current",
    privacyCompliant: report.readiness.privacyCompliant,
    advisories: report.securityWarnings,
    reason: upgradeReason(report, status),
    recommendedCommand: "rgr upgrade",
    safeActivation: true,
  }
}

export async function upgradeProject(options: UpgradeOptions = {}): Promise<UpgradeResult> {
  const cwd = options.cwd ?? process.cwd()
  const before = await inspectUpgrade(cwd)
  const setupOptions: SetupOptions = { cwd, ingest: true }
  if (options.agents !== undefined) {
    setupOptions.agents = options.agents
  }
  if (options.forceAgentSkills !== undefined) {
    setupOptions.forceAgentSkills = options.forceAgentSkills
  }
  const setup = await setupProject(setupOptions)
  let ingestionMode: IngestionRunMode | null = null
  if (setup.ingested) {
    const progress = await getIngestionProgress(await loadConfig(cwd))
    if (progress?.runId === setup.ingested.runId) {
      ingestionMode = progress.mode
    }
  }
  const action = upgradeAction(setup.ingested, ingestionMode)
  const after = await inspectUpgrade(cwd)

  return {
    ...after,
    action,
    previousIndexedWithRagmirVersion: before.indexedWithRagmirVersion,
    previousIndexKeptUntilActivation: action === "rebuilt",
    doctor: setup.doctor,
  }
}

function upgradeStatus(report: DoctorReport, manifestFound: boolean): UpgradeStatus {
  if (!manifestFound) {
    return "index-required"
  }
  if (!report.readiness.indexPolicyCurrent) {
    return "rebuild-required"
  }
  if (!report.readiness.operationalReady) {
    return "repair-required"
  }
  return "current"
}

function upgradeReason(report: DoctorReport, status: UpgradeStatus): string | null {
  if (status === "current") {
    return null
  }
  if (status === "index-required") {
    return "No compatible active index manifest is available. Upgrade will stage a fresh index from the configured sources."
  }
  if (status === "rebuild-required") {
    return (
      report.indexFreshness.warning ??
      "The active index policy differs from this Ragmir runtime and requires a staged rebuild."
    )
  }
  return report.nextSteps[0] ?? "The active index needs repair before retrieval is ready."
}

function upgradeAction(
  ingested: IngestResult | null,
  ingestionMode: IngestionRunMode | null,
): UpgradeResult["action"] {
  if (!ingested) {
    return "none"
  }
  return ingestionMode === "rebuild" ? "rebuilt" : "indexed"
}

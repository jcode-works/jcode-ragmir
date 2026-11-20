import { createHash, randomUUID } from "node:crypto"
import { realpathSync } from "node:fs"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { z } from "zod"
import { isRecord } from "./guards.js"

/**
 * Settings that run a program on this machine, send passages or a secret off it, or read files
 * outside the project. Project config files arrive with a clone or a pull, so these take effect
 * only once the person running Ragmir approves them on this machine (`rgr trust`).
 */
export type GatedSettingName =
  | "pdfOcrCommand"
  | "imageOcrCommand"
  | "legacyWordCommand"
  | "embeddingEndpoint"
  | "embeddingApiKeyEnv"
  | "transformersAllowRemoteModels"
  | "sources"
  | "rawDir"

export interface GatedSetting {
  name: GatedSettingName
  value: string | string[] | boolean
  /** What the setting does once approved, in one sentence for the person approving it. */
  reason: string
}

export interface ConfigTrustState {
  /** `not-needed`: no gated setting; `trusted`: approved here; `untrusted`: inactive until approved. */
  status: "not-needed" | "trusted" | "untrusted"
  settings: GatedSetting[]
  /** SHA-256 of the project and its gated settings; null when nothing needs approval. */
  fingerprint: string | null
  /** How a trusted state was granted: a recorded approval or `RAGMIR_TRUST_PROJECT_CONFIG=1`. */
  grantedBy?: "approval" | "environment"
}

export interface ConfigTrustApproval {
  projectRoot: string
  fingerprint: string
  approvedAt: string
  settings: GatedSettingName[]
}

/** Environment opt-in for CI and containers whose project config is reviewed elsewhere. */
export const TRUST_PROJECT_CONFIG_ENV = "RAGMIR_TRUST_PROJECT_CONFIG"
const TRUST_DIRECTORY_ENV = "RAGMIR_TRUST_DIR"
const TRUST_FILENAME = "trust.json"
const MAX_TRUST_APPROVALS = 1_000

const trustStoreSchema = z.object({
  version: z.literal(1),
  approvals: z
    .array(
      z.object({
        projectRoot: z.string().min(1),
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
        approvedAt: z.string(),
        settings: z.array(z.string()),
      }),
    )
    .max(MAX_TRUST_APPROVALS),
})

const LOOPBACK_HOSTS = new Set(["localhost", "::1"])

/** Values the project config files hold, before defaults and environment overrides. */
export interface ProjectFileSettings {
  pdfOcrCommand?: unknown
  imageOcrCommand?: unknown
  legacyWordCommand?: unknown
  embeddingProvider?: unknown
  embeddingEndpoint?: unknown
  embeddingApiKeyEnv?: unknown
  transformersAllowRemoteModels?: unknown
  sources?: unknown
  rawDir?: unknown
}

/** The effective values after defaults and environment overrides. */
export interface EffectiveGatedValues {
  pdfOcrCommand: string[]
  imageOcrCommand: string[]
  legacyWordCommand: string[]
  embeddingProvider: string
  embeddingEndpoint: string | null
  embeddingApiKeyEnv: string | null
  transformersAllowRemoteModels: boolean
  sources: string[]
  rawDir: string
}

/**
 * Gated settings whose effective value comes from a project config file. A value an environment
 * override replaced was chosen by the operator and needs no approval.
 */
export function gatedSettings(
  projectRoot: string,
  fileSettings: ProjectFileSettings,
  effective: EffectiveGatedValues,
  sourcesFileEntries: readonly string[] = [],
): GatedSetting[] {
  const settings: GatedSetting[] = []
  for (const name of ["pdfOcrCommand", "imageOcrCommand", "legacyWordCommand"] as const) {
    const fromFile = fileSettings[name]
    const value = effective[name]
    if (value.length > 0 && sameJson(fromFile, value)) {
      settings.push({
        name,
        value,
        reason: "Runs this program on this machine while indexing.",
      })
    }
  }
  const openAiCompatible = effective.embeddingProvider === "openai-compatible"
  if (
    openAiCompatible &&
    effective.embeddingEndpoint !== null &&
    fileSettings.embeddingEndpoint === effective.embeddingEndpoint &&
    !isLoopbackUrl(effective.embeddingEndpoint)
  ) {
    settings.push({
      name: "embeddingEndpoint",
      value: effective.embeddingEndpoint,
      reason: "Sends indexed passages and queries to this server.",
    })
  }
  if (
    openAiCompatible &&
    effective.embeddingApiKeyEnv !== null &&
    fileSettings.embeddingApiKeyEnv === effective.embeddingApiKeyEnv
  ) {
    settings.push({
      name: "embeddingApiKeyEnv",
      value: effective.embeddingApiKeyEnv,
      reason: "Sends the value of this environment variable to the embedding endpoint.",
    })
  }
  if (
    effective.transformersAllowRemoteModels &&
    fileSettings.transformersAllowRemoteModels === true
  ) {
    settings.push({
      name: "transformersAllowRemoteModels",
      value: true,
      reason: "Downloads model files from the network when they are missing.",
    })
  }
  const fileSources = Array.isArray(fileSettings.sources)
    ? fileSettings.sources.filter((entry): entry is string => typeof entry === "string")
    : []
  const outside = [...fileSources, ...sourcesFileEntries].filter((entry) =>
    sourceEntryLeavesProject(projectRoot, entry),
  )
  if (outside.length > 0) {
    settings.push({
      name: "sources",
      value: [...new Set(outside)],
      reason: "Reads and indexes files outside the project.",
    })
  }
  if (
    typeof fileSettings.rawDir === "string" &&
    resolvedPathLeavesProject(projectRoot, effective.rawDir) &&
    path.resolve(projectRoot, fileSettings.rawDir) === path.resolve(projectRoot, effective.rawDir)
  ) {
    settings.push({
      name: "rawDir",
      value: fileSettings.rawDir,
      reason: "Reads and indexes this folder outside the project.",
    })
  }
  return settings
}

/** Whether a source entry (not an exclusion or comment) reaches outside the project root. */
export function sourceEntryLeavesProject(projectRoot: string, entry: string): boolean {
  const trimmed = entry.trim()
  if (trimmed === "" || trimmed.startsWith("!") || trimmed.startsWith("#")) {
    return false
  }
  return resolvedPathLeavesProject(projectRoot, trimmed)
}

function resolvedPathLeavesProject(projectRoot: string, value: string): boolean {
  const candidate = path.isAbsolute(value) ? path.relative(projectRoot, value) : value
  if (path.isAbsolute(candidate)) {
    // Another drive on Windows: path.relative cannot express it relative to the root.
    return true
  }
  const normalized = path.posix.normalize(candidate.replaceAll("\\", "/"))
  return normalized === ".." || normalized.startsWith("../")
}

function isLoopbackUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.replace(/^\[|\]$/gu, "").toLowerCase()
    return LOOPBACK_HOSTS.has(host) || host.endsWith(".localhost") || /^127\./u.test(host)
  } catch {
    return false
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** Stable identity of a project and the exact gated settings an approval covers. */
export function configTrustFingerprint(
  projectRoot: string,
  settings: readonly GatedSetting[],
): string {
  const canonical = [...settings]
    .map((setting) => ({ name: setting.name, value: setting.value }))
    .sort((left, right) => left.name.localeCompare(right.name))
  return createHash("sha256")
    .update(
      JSON.stringify({ version: 1, projectRoot: canonicalProjectRoot(projectRoot), canonical }),
    )
    .digest("hex")
}

/** Decide whether the project's gated settings may take effect on this machine. */
export async function evaluateConfigTrust(
  projectRoot: string,
  settings: GatedSetting[],
): Promise<ConfigTrustState> {
  if (settings.length === 0) {
    return { status: "not-needed", settings, fingerprint: null }
  }
  const fingerprint = configTrustFingerprint(projectRoot, settings)
  if (process.env[TRUST_PROJECT_CONFIG_ENV] === "1") {
    return { status: "trusted", settings, fingerprint, grantedBy: "environment" }
  }
  const store = await readTrustStore()
  const root = canonicalProjectRoot(projectRoot)
  const approved = store.approvals.some(
    (approval) => approval.projectRoot === root && approval.fingerprint === fingerprint,
  )
  return approved
    ? { status: "trusted", settings, fingerprint, grantedBy: "approval" }
    : { status: "untrusted", settings, fingerprint }
}

/** Record this machine's approval of the project's current gated settings. */
export async function approveConfigTrust(
  projectRoot: string,
  settings: GatedSetting[],
): Promise<ConfigTrustApproval | null> {
  if (settings.length === 0) {
    return null
  }
  const root = canonicalProjectRoot(projectRoot)
  const approval: ConfigTrustApproval = {
    projectRoot: root,
    fingerprint: configTrustFingerprint(projectRoot, settings),
    approvedAt: new Date().toISOString(),
    settings: settings.map((setting) => setting.name),
  }
  const store = await readTrustStore()
  const others = store.approvals.filter((existing) => existing.projectRoot !== root)
  await writeTrustStore([...others, approval].slice(-MAX_TRUST_APPROVALS))
  return approval
}

/** Remove this machine's approval for a project; returns whether one existed. */
export async function revokeConfigTrust(projectRoot: string): Promise<boolean> {
  const root = canonicalProjectRoot(projectRoot)
  const store = await readTrustStore()
  const remaining = store.approvals.filter((approval) => approval.projectRoot !== root)
  if (remaining.length === store.approvals.length) {
    return false
  }
  await writeTrustStore(remaining)
  return true
}

/** Every approval recorded on this machine. */
export async function listConfigTrust(): Promise<ConfigTrustApproval[]> {
  return (await readTrustStore()).approvals.map((approval) => ({
    ...approval,
    settings: approval.settings.filter(isGatedSettingName),
  }))
}

/** Where approvals live: outside every project, so a repository cannot ship its own approval. */
export function trustStorePath(): string {
  const override = process.env[TRUST_DIRECTORY_ENV]
  if (override) {
    return path.join(path.resolve(override), TRUST_FILENAME)
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming")
    return path.join(appData, "ragmir", TRUST_FILENAME)
  }
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
  return path.join(configHome, "ragmir", TRUST_FILENAME)
}

async function readTrustStore(): Promise<z.infer<typeof trustStoreSchema>> {
  let raw: string
  try {
    raw = await readFile(trustStorePath(), "utf8")
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      return { version: 1, approvals: [] }
    }
    throw error
  }
  const parsed = trustStoreSchema.safeParse(JSON.parse(raw))
  // A damaged store grants nothing; the next approval rewrites it.
  return parsed.success ? parsed.data : { version: 1, approvals: [] }
}

async function writeTrustStore(
  approvals: ReadonlyArray<z.infer<typeof trustStoreSchema>["approvals"][number]>,
): Promise<void> {
  const target = trustStorePath()
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
  const temporary = path.join(path.dirname(target), `.${TRUST_FILENAME}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, `${JSON.stringify({ version: 1, approvals }, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    })
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true })
  }
}

function canonicalProjectRoot(projectRoot: string): string {
  try {
    return realpathSync.native(projectRoot)
  } catch {
    return path.resolve(projectRoot)
  }
}

function isGatedSettingName(value: string): value is GatedSettingName {
  return [
    "pdfOcrCommand",
    "imageOcrCommand",
    "legacyWordCommand",
    "embeddingEndpoint",
    "embeddingApiKeyEnv",
    "transformersAllowRemoteModels",
    "sources",
    "rawDir",
  ].includes(value)
}

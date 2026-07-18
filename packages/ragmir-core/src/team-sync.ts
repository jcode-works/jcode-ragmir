import { spawn } from "node:child_process"
import path from "node:path"
import { doctor } from "./doctor.js"
import { ingest } from "./ingest.js"
import { throwIfAborted } from "./operation.js"
import type { DoctorReport, IngestOptions, IngestResult, OperationOptions } from "./types.js"

const DEFAULT_GIT_TIMEOUT_MS = 30_000
const MAX_GIT_TIMEOUT_MS = 300_000
const MAX_GIT_OUTPUT_BYTES = 1_048_576
const BRANCH_TRACKING_FORMAT =
  "%(refname:short)%00%(upstream)%00%(upstream:short)%00%(upstream:remotename)%00%(upstream:remoteref)"

export type TeamSyncStatus =
  | "current"
  | "updated"
  | "action-required"
  | "offline"
  | "local-only"
  | "setup-required"
  | "index-not-ready"

export type TeamSyncGitState =
  | "current"
  | "updated"
  | "update-available"
  | "dirty"
  | "ahead"
  | "diverged"
  | "detached"
  | "no-upstream"
  | "not-fetched"
  | "fetch-failed"
  | "update-failed"
  | "not-repository"
  | "inspection-failed"

export interface SyncTeamKnowledgeOptions extends OperationOptions {
  cwd?: string
  autoPull?: boolean
  fetch?: boolean
  check?: boolean
  gitTimeoutMs?: number
}

export interface TeamSyncGitReport {
  state: TeamSyncGitState
  available: boolean
  root: string | null
  branch: string | null
  upstream: string | null
  head: string | null
  upstreamHead: string | null
  dirty: boolean | null
  ahead: number | null
  behind: number | null
  fetched: boolean
  freshnessVerified: boolean
  autoPull: boolean
  updated: boolean
}

export interface TeamSyncIndexReport {
  attempted: boolean
  operationalReady: boolean
  indexPolicyCurrent: boolean
  lastGoodIndexAvailable: boolean
  indexedFiles: number
  chunksIndexed: number
  rebuiltFiles: number
  reusedFiles: number
  errorCount: number
  securityAdvisories: number
}

export interface TeamSyncReport {
  status: TeamSyncStatus
  synchronized: boolean
  summary: string
  git: TeamSyncGitReport
  index: TeamSyncIndexReport
  warnings: string[]
  recommendedActions: string[]
}

interface GitCommandResult {
  code: number | null
  stdout: string
  unavailable: boolean
  timedOut: boolean
}

interface BranchTracking {
  branch: string
  upstream: string
  upstreamRef: string
  remote: string
  remoteRef: string
}

interface AheadBehind {
  ahead: number
  behind: number
}

export async function syncTeamKnowledge(
  options: SyncTeamKnowledgeOptions = {},
): Promise<TeamSyncReport> {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const initialDoctor = await doctorWithSignal(cwd, options.signal)
  const projectRoot = initialDoctor.projectRoot
  const autoPull = options.autoPull !== false
  const fetch = options.fetch !== false
  const check = options.check === true
  const gitTimeoutMs = validateGitTimeout(options.gitTimeoutMs ?? DEFAULT_GIT_TIMEOUT_MS)

  if (!initialDoctor.initialized) {
    const git = emptyGitReport("inspection-failed", autoPull)
    const index = indexReport(initialDoctor, false)
    return assembleReport(
      git,
      index,
      ["Ragmir is not initialized in this project."],
      ["Run `rgr setup`, then run `rgr team sync` again."],
    )
  }

  const gitOptions: {
    autoPull: boolean
    fetch: boolean
    gitTimeoutMs: number
    signal?: AbortSignal
  } = {
    autoPull: autoPull && !check,
    fetch,
    gitTimeoutMs,
  }
  if (options.signal) {
    gitOptions.signal = options.signal
  }
  const git = await synchronizeGit(projectRoot, gitOptions)
  const index = check
    ? indexReport(initialDoctor, false)
    : await refreshIndex(projectRoot, initialDoctor, options.signal)
  const warnings = gitWarnings(git, check)
  const actions = buildRecommendedActions(git, index, check)
  return assembleReport(git, index, warnings, actions)
}

async function synchronizeGit(
  cwd: string,
  options: {
    autoPull: boolean
    fetch: boolean
    gitTimeoutMs: number
    signal?: AbortSignal
  },
): Promise<TeamSyncGitReport> {
  const rootResult = await runGit(cwd, ["rev-parse", "--show-toplevel"], options)
  throwIfAborted(options.signal)
  if (rootResult.unavailable || rootResult.code !== 0) {
    return emptyGitReport("not-repository", options.autoPull)
  }

  const root = path.resolve(rootResult.stdout.trim())
  const branchResult = await runGit(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], options)
  const head = await readRevision(root, "HEAD", options)
  if (branchResult.code !== 0 || !head) {
    return {
      ...emptyGitReport("detached", options.autoPull),
      available: true,
      root,
      head,
    }
  }

  const branch = branchResult.stdout.trim()
  const tracking = await readBranchTracking(root, branch, options)
  if (!tracking) {
    return {
      ...emptyGitReport("no-upstream", options.autoPull),
      available: true,
      root,
      branch,
      head,
    }
  }

  let fetched = false
  let freshnessVerified = tracking.remote.length === 0 || tracking.remote === "."
  if (options.fetch && tracking.remote.length > 0 && tracking.remote !== ".") {
    const fetchResult = await runGit(
      root,
      [
        "fetch",
        "--quiet",
        "--no-tags",
        "--show-forced-updates",
        "--",
        tracking.remote,
        `+${tracking.remoteRef}:${tracking.upstreamRef}`,
      ],
      options,
    )
    throwIfAborted(options.signal)
    if (fetchResult.code !== 0) {
      return await gitReport(
        "fetch-failed",
        root,
        tracking,
        head,
        false,
        false,
        options.autoPull,
        options,
      )
    }
    fetched = true
    freshnessVerified = true
  } else if (!options.fetch && tracking.remote.length > 0 && tracking.remote !== ".") {
    return await gitReport(
      "not-fetched",
      root,
      tracking,
      head,
      false,
      false,
      options.autoPull,
      options,
    )
  }

  const report = await gitReport(
    "inspection-failed",
    root,
    tracking,
    head,
    fetched,
    freshnessVerified,
    options.autoPull,
    options,
  )
  if (report.dirty === null || report.ahead === null || report.behind === null) {
    return report
  }
  if (report.dirty) {
    return { ...report, state: "dirty" }
  }
  if (report.ahead > 0 && report.behind > 0) {
    return { ...report, state: "diverged" }
  }
  if (report.ahead > 0) {
    return { ...report, state: "ahead" }
  }
  if (report.behind === 0) {
    return { ...report, state: "current" }
  }
  if (!options.autoPull) {
    return { ...report, state: "update-available" }
  }

  const mergeResult = await runGit(
    root,
    ["merge", "--ff-only", "--quiet", "--", tracking.upstreamRef],
    options,
  )
  throwIfAborted(options.signal)
  if (mergeResult.code !== 0) {
    return { ...report, state: "update-failed" }
  }
  const [updatedHead, updatedCounts, updatedDirty] = await Promise.all([
    readRevision(root, "HEAD", options),
    readAheadBehind(root, tracking.upstreamRef, options),
    readDirty(root, options),
  ])
  const updatedReport: TeamSyncGitReport = {
    ...report,
    state: "update-failed",
    head: updatedHead ?? report.head,
    ahead: updatedCounts?.ahead ?? null,
    behind: updatedCounts?.behind ?? null,
    dirty: updatedDirty,
    updated: true,
  }
  if (!updatedCounts || updatedDirty === null) {
    return updatedReport
  }
  if (updatedDirty) {
    return { ...updatedReport, state: "dirty" }
  }
  if (updatedCounts.ahead > 0 && updatedCounts.behind > 0) {
    return { ...updatedReport, state: "diverged" }
  }
  if (updatedCounts.behind > 0) {
    return updatedReport
  }
  if (updatedCounts.ahead > 0) {
    return { ...updatedReport, state: "ahead" }
  }
  return { ...updatedReport, state: "updated" }
}

async function gitReport(
  state: TeamSyncGitState,
  root: string,
  tracking: BranchTracking,
  head: string,
  fetched: boolean,
  freshnessVerified: boolean,
  autoPull: boolean,
  options: { gitTimeoutMs: number; signal?: AbortSignal },
): Promise<TeamSyncGitReport> {
  const [upstreamHead, counts, dirty] = await Promise.all([
    readRevision(root, tracking.upstreamRef, options),
    readAheadBehind(root, tracking.upstreamRef, options),
    readDirty(root, options),
  ])
  return {
    state,
    available: true,
    root,
    branch: tracking.branch,
    upstream: tracking.upstream,
    head,
    upstreamHead,
    dirty,
    ahead: counts?.ahead ?? null,
    behind: counts?.behind ?? null,
    fetched,
    freshnessVerified,
    autoPull,
    updated: false,
  }
}

async function readBranchTracking(
  root: string,
  branch: string,
  options: { gitTimeoutMs: number; signal?: AbortSignal },
): Promise<BranchTracking | null> {
  const result = await runGit(
    root,
    ["for-each-ref", `--format=${BRANCH_TRACKING_FORMAT}`, "--", `refs/heads/${branch}`],
    options,
  )
  if (result.code !== 0) {
    return null
  }
  const fields = result.stdout
    .trimEnd()
    .split("\0")
    .map((field) => field.trim())
  const [resolvedBranch, upstreamRef, upstream, remote, remoteRef] = fields
  if (!resolvedBranch || !upstreamRef || !upstream || remote === undefined || !remoteRef) {
    return null
  }
  return { branch: resolvedBranch, upstream, upstreamRef, remote, remoteRef }
}

async function readRevision(
  root: string,
  revision: string,
  options: { gitTimeoutMs: number; signal?: AbortSignal },
): Promise<string | null> {
  const result = await runGit(root, ["rev-parse", "--verify", `${revision}^{commit}`], options)
  const value = result.stdout.trim()
  return result.code === 0 && /^[0-9a-f]{40,64}$/u.test(value) ? value : null
}

async function readAheadBehind(
  root: string,
  upstreamRef: string,
  options: { gitTimeoutMs: number; signal?: AbortSignal },
): Promise<AheadBehind | null> {
  const result = await runGit(
    root,
    ["rev-list", "--left-right", "--count", `HEAD...${upstreamRef}`],
    options,
  )
  if (result.code !== 0) {
    return null
  }
  const [aheadText, behindText] = result.stdout.trim().split(/\s+/u)
  const ahead = Number(aheadText)
  const behind = Number(behindText)
  return Number.isSafeInteger(ahead) && Number.isSafeInteger(behind) ? { ahead, behind } : null
}

async function readDirty(
  root: string,
  options: { gitTimeoutMs: number; signal?: AbortSignal },
): Promise<boolean | null> {
  const result = await runGit(
    root,
    ["status", "--porcelain=v1", "-z", "--untracked-files=normal"],
    options,
  )
  return result.code === 0 ? result.stdout.length > 0 : null
}

async function refreshIndex(
  cwd: string,
  fallback: DoctorReport,
  signal: AbortSignal | undefined,
): Promise<TeamSyncIndexReport> {
  let ingestResult: IngestResult | undefined
  try {
    const ingestOptions: IngestOptions = { cwd }
    if (signal) {
      ingestOptions.signal = signal
    }
    ingestResult = await ingest(ingestOptions)
  } catch (_error) {
    throwIfAborted(signal)
    const report = await doctorWithSignal(cwd, signal).catch(() => fallback)
    return indexReport(report, true, undefined, 1)
  }
  const report = await doctorWithSignal(cwd, signal)
  return indexReport(report, true, ingestResult)
}

function indexReport(
  report: DoctorReport,
  attempted: boolean,
  ingestion?: IngestResult,
  fallbackErrorCount = 0,
): TeamSyncIndexReport {
  const operationalReady = report.readiness.operationalReady
  const indexPolicyCurrent = report.readiness.indexPolicyCurrent
  return {
    attempted,
    operationalReady,
    indexPolicyCurrent,
    lastGoodIndexAvailable: operationalReady && indexPolicyCurrent,
    indexedFiles: report.indexedFiles,
    chunksIndexed: report.chunksIndexed,
    rebuiltFiles: ingestion?.rebuiltFiles ?? 0,
    reusedFiles: ingestion?.reusedFiles ?? 0,
    errorCount: ingestion?.errors.length ?? fallbackErrorCount,
    securityAdvisories: report.securityWarnings.length,
  }
}

function assembleReport(
  git: TeamSyncGitReport,
  index: TeamSyncIndexReport,
  warnings: string[],
  recommendedActions: string[],
): TeamSyncReport {
  const indexReady = index.operationalReady && index.indexPolicyCurrent && index.errorCount === 0
  const sourceCurrent =
    (git.state === "current" || git.state === "updated") && git.freshnessVerified
  const synchronized = sourceCurrent && indexReady
  const status = teamSyncStatus(git, indexReady)
  return {
    status,
    synchronized,
    summary: teamSyncSummary(status, git, index),
    git,
    index,
    warnings,
    recommendedActions,
  }
}

function teamSyncStatus(git: TeamSyncGitReport, indexReady: boolean): TeamSyncStatus {
  if (git.state === "inspection-failed" && !git.available) {
    return "setup-required"
  }
  if (git.state === "not-repository") {
    return "local-only"
  }
  if (git.state === "fetch-failed" || git.state === "not-fetched") {
    return "offline"
  }
  if (git.state === "current" || git.state === "updated") {
    if (!indexReady) {
      return "index-not-ready"
    }
    return git.state
  }
  return "action-required"
}

function teamSyncSummary(
  status: TeamSyncStatus,
  git: TeamSyncGitReport,
  index: TeamSyncIndexReport,
): string {
  if (status === "current") {
    return "The checked-out branch matches its fetched upstream and the local index is current."
  }
  if (status === "updated") {
    return "The checked-out branch was fast-forwarded safely and the local index was refreshed."
  }
  if (status === "offline") {
    return index.lastGoodIndexAvailable
      ? "The upstream could not be verified; the last valid local index remains available."
      : "The upstream could not be verified and no ready local index is available."
  }
  if (status === "local-only") {
    return "No Git worktree was detected; Ragmir refreshed only the local index."
  }
  if (status === "setup-required") {
    return "Ragmir setup is required before team synchronization."
  }
  if (status === "index-not-ready") {
    return "Git is current, but the local index needs repair before retrieval."
  }
  return `Git needs one explicit decision (${git.state}); Ragmir did not rewrite branch history.`
}

function gitWarnings(git: TeamSyncGitReport, check: boolean): string[] {
  const warnings: string[] = []
  if (check) {
    warnings.push("Check mode did not change the worktree or refresh the index.")
  }
  if (git.state === "fetch-failed") {
    warnings.push("Git authentication, connectivity, or the configured upstream fetch failed.")
  }
  if (git.state === "not-fetched") {
    warnings.push("The remote was not fetched, so upstream freshness is not verified.")
  }
  if (git.state === "dirty") {
    warnings.push("Tracked or untracked worktree changes prevent an automatic fast-forward.")
  }
  return warnings
}

function buildRecommendedActions(
  git: TeamSyncGitReport,
  index: TeamSyncIndexReport,
  check: boolean,
): string[] {
  const actions: string[] = []
  if (git.state === "update-available") {
    actions.push("Run `rgr team sync` without `--check` or `--no-pull` to apply the safe update.")
  } else if (git.state === "dirty") {
    actions.push("Commit or temporarily move local changes, then run `rgr team sync` again.")
  } else if (git.state === "ahead") {
    actions.push("Push the branch and open or update its merge request so teammates can review it.")
  } else if (git.state === "diverged") {
    actions.push("Resolve the branch divergence through the normal Git and merge-request workflow.")
  } else if (git.state === "detached") {
    actions.push("Check out a branch with an upstream, then run `rgr team sync` again.")
  } else if (git.state === "no-upstream") {
    actions.push("Configure an upstream for the current branch, then run `rgr team sync` again.")
  } else if (git.state === "fetch-failed") {
    actions.push("Restore Git network or authentication access, then run `rgr team sync` again.")
  } else if (git.state === "not-fetched") {
    actions.push("Run `rgr team sync` without `--no-fetch` to verify the latest upstream revision.")
  } else if (git.state === "update-failed" || git.state === "inspection-failed") {
    actions.push("Inspect `git status` and the branch upstream before retrying team sync.")
  } else if (git.state === "not-repository") {
    actions.push(
      "Connect the project to Git for automatic team sync, or continue in local-only mode.",
    )
  }

  const indexReady = index.operationalReady && index.indexPolicyCurrent && index.errorCount === 0
  if (!indexReady && !check) {
    actions.push("Run `rgr doctor --fix` to repair the local index without deleting it first.")
  }
  if (index.securityAdvisories > 0) {
    actions.push("Review non-blocking privacy advisories with `rgr security-audit`.")
  }
  return actions
}

function emptyGitReport(state: TeamSyncGitState, autoPull: boolean): TeamSyncGitReport {
  return {
    state,
    available: false,
    root: null,
    branch: null,
    upstream: null,
    head: null,
    upstreamHead: null,
    dirty: null,
    ahead: null,
    behind: null,
    fetched: false,
    freshnessVerified: false,
    autoPull,
    updated: false,
  }
}

function validateGitTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_GIT_TIMEOUT_MS) {
    throw new Error(
      `gitTimeoutMs must be a positive integer no greater than ${MAX_GIT_TIMEOUT_MS}.`,
    )
  }
  return value
}

function doctorWithSignal(cwd: string, signal: AbortSignal | undefined): Promise<DoctorReport> {
  return signal ? doctor(cwd, { signal }) : doctor(cwd)
}

function runGit(
  cwd: string,
  args: string[],
  options: { gitTimeoutMs: number; signal?: AbortSignal },
): Promise<GitCommandResult> {
  const timeoutSignal = AbortSignal.timeout(options.gitTimeoutMs)
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal
  const { GIT_DIR: _gitDir, GIT_WORK_TREE: _gitWorkTree, ...inheritedEnvironment } = process.env

  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-c", "color.ui=false", ...args], {
      cwd,
      env: {
        ...inheritedEnvironment,
        GIT_TERMINAL_PROMPT: "0",
        GCM_INTERACTIVE: "never",
        LC_ALL: "C",
      },
      signal,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    })
    const stdout: Buffer[] = []
    let stdoutBytes = 0
    let settled = false

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdoutBytes >= MAX_GIT_OUTPUT_BYTES) {
        return
      }
      const remaining = MAX_GIT_OUTPUT_BYTES - stdoutBytes
      const bounded = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk
      stdout.push(bounded)
      stdoutBytes += bounded.length
    })
    child.once("error", (error) => {
      if (settled) {
        return
      }
      settled = true
      if (options.signal?.aborted) {
        reject(error)
        return
      }
      resolve({
        code: null,
        stdout: Buffer.concat(stdout).toString("utf8"),
        unavailable: isNodeError(error) && error.code === "ENOENT",
        timedOut: timeoutSignal.aborted,
      })
    })
    child.once("close", (code) => {
      if (settled) {
        return
      }
      settled = true
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        unavailable: false,
        timedOut: timeoutSignal.aborted,
      })
    })
  })
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

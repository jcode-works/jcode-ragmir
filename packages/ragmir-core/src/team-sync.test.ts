import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { initProject } from "./init.js"
import { syncTeamKnowledge } from "./team-sync.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("team sync", () => {
  it("should fast-forward and refresh the local index when the upstream update is safe", async () => {
    const fixture = await createGitFixture()
    await updateRemote(fixture, "Approved release train v2.\n")

    const report = await syncTeamKnowledge({ cwd: fixture.local })

    expect(report).toMatchObject({
      status: "updated",
      synchronized: true,
      git: {
        state: "updated",
        branch: "main",
        upstream: "origin/main",
        ahead: 0,
        behind: 0,
        fetched: true,
        freshnessVerified: true,
        updated: true,
      },
      index: { attempted: true, operationalReady: true, indexPolicyCurrent: true },
      recommendedActions: [],
    })
    expect(await readFile(path.join(fixture.local, "docs", "decision.md"), "utf8")).toBe(
      "Approved release train v2.\n",
    )
  })

  it("should keep the branch untouched when automatic pulling is disabled", async () => {
    const fixture = await createGitFixture()
    await updateRemote(fixture, "Remote-only update.\n")
    const headBefore = await git(fixture.local, ["rev-parse", "HEAD"])

    const report = await syncTeamKnowledge({ cwd: fixture.local, autoPull: false })

    expect(report).toMatchObject({
      status: "action-required",
      synchronized: false,
      git: { state: "update-available", ahead: 0, behind: 1, updated: false },
      index: { attempted: true, operationalReady: true },
    })
    expect(await git(fixture.local, ["rev-parse", "HEAD"])).toBe(headBefore)
    expect(await readFile(path.join(fixture.local, "docs", "decision.md"), "utf8")).toBe(
      "Approved release train v1.\n",
    )
  })

  it("should refuse to fast-forward when the worktree contains local changes", async () => {
    const fixture = await createGitFixture()
    await updateRemote(fixture, "Remote update.\n")
    await writeFile(path.join(fixture.local, "docs", "decision.md"), "Local draft.\n", "utf8")
    const headBefore = await git(fixture.local, ["rev-parse", "HEAD"])

    const report = await syncTeamKnowledge({ cwd: fixture.local })

    expect(report).toMatchObject({
      status: "action-required",
      synchronized: false,
      git: { state: "dirty", dirty: true, behind: 1, updated: false },
      index: { attempted: true, operationalReady: true },
    })
    expect(await git(fixture.local, ["rev-parse", "HEAD"])).toBe(headBefore)
    expect(await readFile(path.join(fixture.local, "docs", "decision.md"), "utf8")).toBe(
      "Local draft.\n",
    )
  })

  it("should require the merge-request workflow when local and upstream histories diverge", async () => {
    const fixture = await createGitFixture()
    await writeFile(path.join(fixture.local, "docs", "decision.md"), "Local commit.\n", "utf8")
    await git(fixture.local, ["add", "docs/decision.md"])
    await git(fixture.local, ["commit", "-m", "docs: update local decision"])
    await updateRemote(fixture, "Remote commit.\n")
    const headBefore = await git(fixture.local, ["rev-parse", "HEAD"])

    const report = await syncTeamKnowledge({ cwd: fixture.local })

    expect(report).toMatchObject({
      status: "action-required",
      synchronized: false,
      git: { state: "diverged", dirty: false, ahead: 1, behind: 1, updated: false },
    })
    expect(report.recommendedActions.join(" ")).toContain("merge-request workflow")
    expect(await git(fixture.local, ["rev-parse", "HEAD"])).toBe(headBefore)
  }, 15_000)

  it("should reject an automatic update when the upstream history was force-rewritten", async () => {
    const fixture = await createGitFixture()
    const tree = await git(fixture.author, ["rev-parse", "HEAD^{tree}"])
    const rewritten = await git(fixture.author, ["commit-tree", tree, "-m", "rewrite upstream"])
    await git(fixture.author, ["push", "--force", "origin", `${rewritten}:main`])
    const headBefore = await git(fixture.local, ["rev-parse", "HEAD"])

    const report = await syncTeamKnowledge({ cwd: fixture.local })

    expect(report).toMatchObject({
      status: "action-required",
      synchronized: false,
      git: { state: "diverged", ahead: 1, behind: 1, updated: false },
    })
    expect(await git(fixture.local, ["rev-parse", "HEAD"])).toBe(headBefore)
  })

  it("should preserve the last valid index when the upstream cannot be fetched", async () => {
    const fixture = await createGitFixture()
    const initial = await syncTeamKnowledge({ cwd: fixture.local })
    expect(initial.synchronized).toBe(true)
    const offlineRemote = `${fixture.remote}.offline`
    await rename(fixture.remote, offlineRemote)

    const report = await syncTeamKnowledge({ cwd: fixture.local, gitTimeoutMs: 2_000 })

    expect(report).toMatchObject({
      status: "offline",
      synchronized: false,
      git: { state: "fetch-failed", freshnessVerified: false, updated: false },
      index: { operationalReady: true, lastGoodIndexAvailable: true },
    })
    expect(report.summary).toContain("last valid local index")
  })

  it("should preview the upstream update without changing the branch or index in check mode", async () => {
    const fixture = await createGitFixture()
    await syncTeamKnowledge({ cwd: fixture.local })
    await updateRemote(fixture, "Previewed update.\n")
    const headBefore = await git(fixture.local, ["rev-parse", "HEAD"])

    const report = await syncTeamKnowledge({ cwd: fixture.local, check: true })

    expect(report).toMatchObject({
      status: "action-required",
      synchronized: false,
      git: { state: "update-available", behind: 1, updated: false },
      index: { attempted: false, operationalReady: true },
    })
    expect(report.warnings).toContain(
      "Check mode did not change the worktree or refresh the index.",
    )
    expect(await git(fixture.local, ["rev-parse", "HEAD"])).toBe(headBefore)
  })

  it("should avoid remote access and branch updates when fetch is disabled", async () => {
    const fixture = await createGitFixture()
    await updateRemote(fixture, "Unfetched update.\n")
    const headBefore = await git(fixture.local, ["rev-parse", "HEAD"])

    const report = await syncTeamKnowledge({ cwd: fixture.local, fetch: false })

    expect(report).toMatchObject({
      status: "offline",
      synchronized: false,
      git: { state: "not-fetched", fetched: false, freshnessVerified: false, updated: false },
      index: { attempted: true, operationalReady: true },
    })
    expect(await git(fixture.local, ["rev-parse", "HEAD"])).toBe(headBefore)
  })

  it("should require an upstream without guessing one when the branch is local", async () => {
    const root = await temporaryDirectory("ragmir-team-no-upstream-")
    await git(root, ["init", "--initial-branch=main"])
    await configureGitIdentity(root)
    await configureRagmir(root)
    await mkdir(path.join(root, "docs"), { recursive: true })
    await writeFile(path.join(root, "docs", "decision.md"), "Local branch decision.\n", "utf8")
    await git(root, ["add", ".gitignore", "docs/decision.md"])
    await git(root, ["commit", "-m", "docs: add local decision"])

    const report = await syncTeamKnowledge({ cwd: root })

    expect(report).toMatchObject({
      status: "action-required",
      synchronized: false,
      git: { state: "no-upstream", branch: "main", updated: false },
      index: { attempted: true, operationalReady: true },
    })
    expect(report.recommendedActions.join(" ")).toContain("Configure an upstream")
  })

  it("should keep detached history unchanged and require a branch decision", async () => {
    const fixture = await createGitFixture()
    await git(fixture.local, ["checkout", "--detach"])
    const headBefore = await git(fixture.local, ["rev-parse", "HEAD"])

    const report = await syncTeamKnowledge({ cwd: fixture.local })

    expect(report).toMatchObject({
      status: "action-required",
      synchronized: false,
      git: { state: "detached", branch: null, updated: false },
      index: { attempted: true, operationalReady: true },
    })
    expect(await git(fixture.local, ["rev-parse", "HEAD"])).toBe(headBefore)
  })

  it("should refresh local knowledge without claiming team synchronization outside Git", async () => {
    const root = await temporaryDirectory("ragmir-team-local-only-")
    await configureRagmir(root)
    await mkdir(path.join(root, "docs"), { recursive: true })
    await writeFile(path.join(root, "docs", "decision.md"), "Local-only decision.\n", "utf8")

    const report = await syncTeamKnowledge({ cwd: root })

    expect(report).toMatchObject({
      status: "local-only",
      synchronized: false,
      git: { state: "not-repository", available: false },
      index: { attempted: true, operationalReady: true },
    })
  })
})

interface GitFixture {
  root: string
  remote: string
  author: string
  local: string
}

async function createGitFixture(): Promise<GitFixture> {
  const root = await temporaryDirectory("ragmir-team-git-")
  const remote = path.join(root, "remote.git")
  const author = path.join(root, "author")
  const local = path.join(root, "local")
  await mkdir(author, { recursive: true })
  await git(root, ["init", "--bare", remote])
  await git(author, ["init", "--initial-branch=main"])
  await configureGitIdentity(author)
  await configureRagmir(author)
  await mkdir(path.join(author, "docs"), { recursive: true })
  await writeFile(path.join(author, "docs", "decision.md"), "Approved release train v1.\n", "utf8")
  await git(author, ["add", ".gitignore", "docs/decision.md"])
  await git(author, ["commit", "-m", "docs: add initial decision"])
  await git(author, ["remote", "add", "origin", remote])
  await git(author, ["push", "--set-upstream", "origin", "main"])
  await git(root, ["clone", remote, local])
  await configureGitIdentity(local)
  await configureRagmir(local)
  return { root, remote, author, local }
}

async function updateRemote(fixture: GitFixture, content: string): Promise<void> {
  await writeFile(path.join(fixture.author, "docs", "decision.md"), content, "utf8")
  await git(fixture.author, ["add", "docs/decision.md"])
  await git(fixture.author, ["commit", "-m", "docs: update shared decision"])
  await git(fixture.author, ["push"])
}

async function configureRagmir(root: string): Promise<void> {
  await initProject(root)
  await writeFile(
    path.join(root, ".ragmir", "config.json"),
    `${JSON.stringify({ sources: ["docs/**/*.md"] }, null, 2)}\n`,
    "utf8",
  )
}

async function configureGitIdentity(root: string): Promise<void> {
  await git(root, ["config", "user.name", "Ragmir Test"])
  await git(root, ["config", "user.email", "ragmir@example.invalid"])
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirs.push(root)
  return root
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        encoding: "utf8",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          reject(error)
          return
        }
        resolve(stdout.trim())
      },
    )
  })
}

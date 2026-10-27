import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { gitHooksStatus, installGitHooks, uninstallGitHooks } from "./git-hooks.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

async function gitRepository(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-git-hooks-"))
  tempDirs.push(root)
  execFileSync("git", ["init", "--quiet"], { cwd: root })
  return root
}

describe("git hooks", () => {
  it("adds one idempotent auto-ingest block and keeps existing hook content", async () => {
    const root = await gitRepository()
    const hooksDir = path.join(root, ".git", "hooks")
    await mkdir(hooksDir, { recursive: true })
    await writeFile(path.join(hooksDir, "post-merge"), "#!/bin/sh\necho merged\nexit 0\n", "utf8")

    const first = await installGitHooks({ cwd: root })
    const second = await installGitHooks({ cwd: root })
    const postMerge = await readFile(path.join(hooksDir, "post-merge"), "utf8")
    const postCommit = await readFile(path.join(hooksDir, "post-commit"), "utf8")

    expect(first.installed).toEqual(["post-checkout", "post-commit", "post-merge", "post-rewrite"])
    expect(second.changed).toEqual([])
    expect(postMerge.indexOf("echo merged")).toBeLessThan(postMerge.indexOf("ragmir auto-ingest"))
    expect(postMerge.indexOf("ragmir auto-ingest")).toBeLessThan(postMerge.indexOf("exit 0"))
    expect(postCommit).toContain("node .ragmir/run.cjs ingest")
    expect(postCommit.match(/>>> ragmir auto-ingest >>>/gu)).toHaveLength(1)

    const removed = await uninstallGitHooks({ cwd: root })
    expect(removed.changed).toHaveLength(4)
    expect(existsSync(path.join(hooksDir, "post-commit"))).toBe(false)
    expect(await readFile(path.join(hooksDir, "post-merge"), "utf8")).toBe(
      "#!/bin/sh\necho merged\nexit 0\n",
    )
    expect((await gitHooksStatus({ cwd: root })).installed).toEqual([])
  })

  it("runs the runner of a nested knowledge base from the repository root", async () => {
    const root = await gitRepository()
    const nested = path.join(root, "docs", "kb")
    await mkdir(nested, { recursive: true })

    await installGitHooks({ cwd: nested })

    const hook = await readFile(path.join(root, ".git", "hooks", "post-checkout"), "utf8")
    expect(hook).toContain("(cd 'docs/kb' 2>/dev/null")
  })

  it("refuses to edit a hooks directory tracked in the working tree unless forced", async () => {
    const root = await gitRepository()
    execFileSync("git", ["config", "core.hooksPath", ".husky"], { cwd: root })

    await expect(installGitHooks({ cwd: root })).rejects.toThrow(/inside the working tree/u)
    const forced = await installGitHooks({ cwd: root, force: true })

    expect(forced.trackedHooksDir).toBe(true)
    expect(existsSync(path.join(root, ".husky", "post-merge"))).toBe(true)
  })
})

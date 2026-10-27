import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { removeTree, renameWithRetry } from "./fs-retry.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

function systemError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: simulated`), { code })
}

describe("Windows-tolerant file operations", () => {
  it("retries a rename that Windows refuses while another process holds the file", async () => {
    const failures = ["EPERM", "EBUSY", "EACCES"]
    const attempts: string[] = []

    await renameWithRetry("source", "target", {
      platform: "win32",
      delaysMs: [0, 0, 0, 0],
      renameFile: async () => {
        const code = failures.shift()
        attempts.push(code ?? "renamed")
        if (code) {
          throw systemError(code)
        }
      },
    })

    expect(attempts).toEqual(["EPERM", "EBUSY", "EACCES", "renamed"])
  })

  it("fails at once on other platforms and errors, and after the last Windows retry", async () => {
    let calls = 0
    const failWith = (code: string) => async (): Promise<void> => {
      calls += 1
      throw systemError(code)
    }

    await expect(
      renameWithRetry("a", "b", { platform: "linux", renameFile: failWith("EPERM") }),
    ).rejects.toMatchObject({ code: "EPERM" })
    expect(calls).toBe(1)

    calls = 0
    await expect(
      renameWithRetry("a", "b", {
        platform: "win32",
        delaysMs: [0],
        renameFile: failWith("ENOENT"),
      }),
    ).rejects.toMatchObject({ code: "ENOENT" })
    expect(calls).toBe(1)

    calls = 0
    await expect(
      renameWithRetry("a", "b", {
        platform: "win32",
        delaysMs: [0, 0],
        renameFile: failWith("EBUSY"),
      }),
    ).rejects.toMatchObject({ code: "EBUSY" })
    expect(calls).toBe(3)
  })

  it("renames real files and removes directory trees", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-fs-retry-"))
    tempDirs.push(root)
    const source = path.join(root, "state.json.tmp")
    const target = path.join(root, "state.json")
    await writeFile(target, "old\n")
    await writeFile(source, "new\n")

    await renameWithRetry(source, target)

    expect(await readFile(target, "utf8")).toBe("new\n")
    const tree = path.join(root, "generation", "nested")
    await mkdir(tree, { recursive: true })
    await writeFile(path.join(tree, "fragment.lance"), "data")
    await removeTree(path.join(root, "generation"))
    await removeTree(path.join(root, "missing"))
    await expect(stat(path.join(root, "generation"))).rejects.toMatchObject({ code: "ENOENT" })
  })
})

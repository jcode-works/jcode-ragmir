import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { ensureRagmirGitignore } from "./gitignore.js"

const roots: string[] = []

async function project(gitignore?: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-gitignore-"))
  roots.push(root)
  if (gitignore !== undefined) await writeFile(path.join(root, ".gitignore"), gitignore, "utf8")
  return root
}

const read = (root: string) => readFile(path.join(root, ".gitignore"), "utf8")

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("ensureRagmirGitignore", () => {
  it("writes the Ragmir block into a project without a .gitignore", async () => {
    const root = await project()
    expect(await ensureRagmirGitignore(root)).toBe(true)
    expect(await read(root)).toBe("# Ragmir\n.ragmir/\n")
  })

  it("appends the block after existing entries", async () => {
    const root = await project("node_modules/\n")
    expect(await ensureRagmirGitignore(root)).toBe(true)
    expect(await read(root)).toBe("node_modules/\n\n# Ragmir\n.ragmir/\n")
  })

  it("changes nothing when every entry is already ignored", async () => {
    const root = await project("# Ragmir\n.ragmir/\n")
    expect(await ensureRagmirGitignore(root)).toBe(false)
    expect(await read(root)).toBe("# Ragmir\n.ragmir/\n")
  })

  it("reuses an existing Ragmir header, prefixed or not, for missing entries", async () => {
    for (const header of ["# Ragmir", "# Acme Ragmir"]) {
      const root = await project(`${header}\n.ragmir/\n`)
      expect(await ensureRagmirGitignore(root, [".ragmir-cache/"])).toBe(true)
      expect(await read(root)).toBe(`${header}\n.ragmir/\n\n.ragmir-cache/\n`)
    }
  })

  it("adds its own header when a comment only mentions Ragmir in passing", async () => {
    const root = await project("# Ragmir notes live in docs/\nnode_modules/\n")
    expect(await ensureRagmirGitignore(root)).toBe(true)
    expect(await read(root)).toBe(
      "# Ragmir notes live in docs/\nnode_modules/\n\n# Ragmir\n.ragmir/\n",
    )
  })
})

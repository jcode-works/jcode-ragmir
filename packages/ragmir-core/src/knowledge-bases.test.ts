import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { discoverKnowledgeBases, knowledgeBaseIdentity } from "./knowledge-bases.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("knowledge bases", () => {
  it("should discover nested bases and select the nearest configured ancestor", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-bases-"))
    tempDirs.push(root)
    const web = path.join(root, "apps", "web")
    const api = path.join(root, "apps", "api")
    const webSource = path.join(web, "src", "features")
    await writeConfig(root)
    await writeConfig(web)
    await writeConfig(api)
    await mkdir(webSource, { recursive: true })

    expect(knowledgeBaseIdentity(webSource)).toEqual({
      id: "apps/web",
      projectRoot: web,
      workspaceRoot: root,
    })

    const inventory = await discoverKnowledgeBases(webSource)

    expect(inventory.workspaceRoot).toBe(root)
    expect(inventory.activeProjectRoot).toBe(web)
    expect(inventory.activeId).toBe("apps/web")
    expect(inventory.bases.map((base) => base.id)).toEqual([".", "apps/api", "apps/web"])
    expect(inventory.bases.find((base) => base.active)?.id).toBe("apps/web")
  })

  it("should report descendant bases when invoked from an unconfigured workspace", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-bases-unconfigured-"))
    tempDirs.push(root)
    await writeConfig(path.join(root, "packages", "docs"))
    await writeConfig(path.join(root, "node_modules", "ignored"))

    const inventory = await discoverKnowledgeBases(root)

    expect(inventory.activeId).toBeNull()
    expect(inventory.bases.map((base) => base.id)).toEqual(["packages/docs"])
  })

  it("should prefer a current Ragmir config when a legacy config also exists", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-bases-legacy-"))
    tempDirs.push(root)
    await writeConfig(root)
    await mkdir(path.join(root, ".kb"), { recursive: true })
    await writeFile(path.join(root, ".kb", "config.json"), "{}\n", "utf8")

    const inventory = await discoverKnowledgeBases(root)

    expect(inventory.bases).toHaveLength(1)
    expect(inventory.bases[0]?.legacy).toBe(false)
    expect(inventory.bases[0]?.configPath).toBe(path.join(root, ".ragmir", "config.json"))
  })
})

async function writeConfig(projectRoot: string): Promise<void> {
  await mkdir(path.join(projectRoot, ".ragmir"), { recursive: true })
  await writeFile(path.join(projectRoot, ".ragmir", "config.json"), "{}\n", "utf8")
}

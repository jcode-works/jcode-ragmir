import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { loadConfig } from "./config.js"
import { ingest } from "./ingest.js"
import { initProject } from "./init.js"
import { expandCitation, search } from "./query.js"
import { readIndexManifest, writeIndexManifest } from "./store.js"
import { inspectUpgrade, upgradeProject } from "./upgrade.js"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-core-migration-"))
  roots.push(root)
  await initProject(root)
  return { root, configPath: path.join(root, ".ragmir/config.json") }
}

describe("source-preserving migration", () => {
  it("should refuse silent removal when a legacy config requests masking", async () => {
    const { root, configPath } = await fixture()
    const previous = JSON.stringify({ redaction: { enabled: true }, privacyProfile: "private" })
    await writeFile(configPath, previous)
    await expect(loadConfig(root)).rejects.toThrow("rgr upgrade")
    await expect(inspectUpgrade(root)).resolves.toMatchObject({
      status: "config-migration-required",
      ready: false,
    })
    expect(await readFile(configPath, "utf8")).toBe(previous)
  })

  it("should preserve original text and exact citations when a legacy index is upgraded", async () => {
    const { root, configPath } = await fixture()
    const source = "# Contact\nOwner: alice@example.test\nAccount: AB1234567\n"
    const sourcePath = path.join(root, ".ragmir/raw/contact.md")
    await writeFile(sourcePath, source)
    await ingest({ cwd: root })
    const config = await loadConfig(root)
    const manifest = await readIndexManifest(config)
    if (!manifest) throw new Error("Expected index manifest")
    await writeIndexManifest(
      { ...manifest, indexPolicyFingerprint: "legacy-masked-policy" },
      config,
      manifest.indexedFiles,
    )
    const legacy = { redaction: { enabled: true }, privacyProfile: "private", accessLog: true }
    await writeFile(configPath, JSON.stringify(legacy))

    const result = await upgradeProject({ cwd: root, agents: [] })
    expect(result).toMatchObject({
      action: "rebuilt",
      status: "current",
      ready: true,
      previousIndexKeptUntilActivation: true,
    })
    expect(result.configMigration.removedKeys).toEqual(["privacyProfile", "redaction", "accessLog"])
    const backup = result.configMigration.backupPath
    if (!backup) throw new Error("Expected migration backup")
    expect(JSON.parse(await readFile(backup, "utf8"))).toEqual(legacy)
    if (process.platform !== "win32") expect((await stat(backup)).mode & 0o777).toBe(0o600)
    const hits = await search("alice@example.test", { cwd: root, topK: 1 })
    expect(hits[0]?.text).toContain("alice@example.test")
    const hit = hits[0]
    if (!hit) throw new Error("Expected contact evidence")
    expect(hit.text).toBe(source.slice(hit.charStart, hit.charEnd))
    const expanded = await expandCitation(hit.citation, { cwd: root })
    expect(expanded.found).toBe(true)
    expect(JSON.stringify(expanded)).toContain("alice@example.test")
    expect((await upgradeProject({ cwd: root, agents: [] })).configMigration).toEqual({
      removedKeys: [],
      backupPath: null,
    })
  }, 20_000)

  it("should keep formerly blocked external operations disabled when migrating strict mode", async () => {
    const { root, configPath } = await fixture()
    await writeFile(
      configPath,
      JSON.stringify({
        privacyProfile: "strict",
        transformersAllowRemoteModels: true,
        pdfOcrCommand: ["ocr-wrapper"],
        imageOcrCommand: ["image-wrapper"],
        legacyWordCommand: ["word-wrapper"],
        mcpMaxTopK: 50,
        mcpMaxOutputBytes: 100_000,
      }),
    )
    await upgradeProject({ cwd: root, agents: [] })
    expect(await loadConfig(root)).toMatchObject({
      transformersAllowRemoteModels: false,
      pdfOcrCommand: [],
      imageOcrCommand: [],
      legacyWordCommand: [],
      mcpMaxTopK: 5,
      mcpMaxOutputBytes: 16_384,
    })
  }, 20_000)
})

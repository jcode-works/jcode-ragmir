import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { loadConfig } from "./config.js"
import { INDEX_MANIFEST_FILENAME } from "./defaults.js"
import { INDEX_SCHEMA_VERSION } from "./index-diagnostics.js"
import { ingest } from "./ingest.js"
import { initProject } from "./init.js"
import { search } from "./query.js"
import { readIndexManifest, writeIndexManifest } from "./store.js"
import { inspectUpgrade, upgradeProject } from "./upgrade.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("upgrade continuity", () => {
  it("should stage and atomically activate a rebuild when the index schema is old", async () => {
    const root = await upgradeFixture()
    const config = await loadConfig(root)
    const currentManifest = await readIndexManifest(config)
    if (!currentManifest) {
      throw new Error("Expected a ready index manifest.")
    }
    const fingerprintBefore = currentManifest.corpusFingerprint
    await writeIndexManifest(
      { ...currentManifest, schemaVersion: INDEX_SCHEMA_VERSION - 1 },
      config,
      currentManifest.indexedFiles,
    )

    await expect(inspectUpgrade(root)).resolves.toMatchObject({
      status: "rebuild-required",
      ready: false,
      safeActivation: true,
    })
    await expect(search("continuity", { cwd: root })).rejects.toThrow("rgr upgrade")

    const result = await upgradeProject({ cwd: root })
    const upgradedManifest = await readIndexManifest(config)

    expect(result).toMatchObject({
      status: "current",
      action: "rebuilt",
      previousIndexKeptUntilActivation: true,
      ready: true,
    })
    expect(upgradedManifest?.schemaVersion).toBe(INDEX_SCHEMA_VERSION)
    expect(upgradedManifest?.corpusFingerprint).toBe(fingerprintBefore)
    await expect(search("continuity", { cwd: root })).resolves.toHaveLength(1)
  }, 20_000)

  it("should apply current safe defaults when an older config omits newer fields", async () => {
    const root = await upgradeFixture()
    const configPath = path.join(root, ".ragmir", "config.json")
    const config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>
    delete config.embeddingModelDigest
    delete config.incrementalFailurePolicy
    delete config.sourceFingerprintMode
    delete config.workloadLimits
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8")

    const inspection = await inspectUpgrade(root)
    const effective = await loadConfig(root)

    expect(inspection.status).toBe("current")
    expect(effective.incrementalFailurePolicy).toBe("preserve-last-good")
    expect(effective.sourceFingerprintMode).toBe("fast")
    await expect(upgradeProject({ cwd: root })).resolves.toMatchObject({
      status: "current",
      action: "none",
      ready: true,
    })
  }, 20_000)

  it("should stage a rebuild when an old index has no compatible manifest", async () => {
    const root = await upgradeFixture()
    const config = await loadConfig(root)
    await Promise.all([
      rm(path.join(config.storageDir, INDEX_MANIFEST_FILENAME), { force: true }),
      rm(path.join(config.storageDir, "index-manifest.previous.json"), { force: true }),
    ])

    await expect(inspectUpgrade(root)).resolves.toMatchObject({
      status: "index-required",
      indexedWithRagmirVersion: null,
    })
    await expect(search("continuity", { cwd: root })).rejects.toThrow("rgr upgrade")
    await expect(upgradeProject({ cwd: root })).resolves.toMatchObject({
      status: "current",
      action: "rebuilt",
      previousIndexedWithRagmirVersion: null,
      previousIndexKeptUntilActivation: true,
      ready: true,
    })
    await expect(search("continuity", { cwd: root })).resolves.toHaveLength(1)
  }, 20_000)
})

async function upgradeFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-upgrade-"))
  tempDirs.push(root)
  await initProject(root)
  await writeFile(
    path.join(root, ".ragmir", "raw", "continuity.md"),
    "Continuous service evidence.\n",
    "utf8",
  )
  await ingest({ cwd: root })
  return root
}

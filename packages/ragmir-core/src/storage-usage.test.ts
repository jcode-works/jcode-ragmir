import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { diskUsage, findStorageOrphans, removeStorageOrphans } from "./storage-usage.js"
import { testConfig } from "./test-support/config.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("storage usage", () => {
  it("lists unused models, storage copies, and retired outputs but keeps the configured model", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-orphans-"))
    tempDirs.push(root)
    const models = path.join(root, ".ragmir", "models")
    const configured = path.join(models, "intfloat", "multilingual-e5-small")
    await mkdir(configured, { recursive: true })
    await mkdir(path.join(models, "mixedbread-ai", "mxbai-embed-xsmall-v1"), { recursive: true })
    await mkdir(path.join(models, "chat"), { recursive: true })
    await mkdir(path.join(models, ".download-staging"), { recursive: true })
    await mkdir(path.join(root, ".ragmir", "storage-2.12-test"), { recursive: true })
    await mkdir(path.join(root, ".ragmir", "reports"), { recursive: true })
    await mkdir(path.join(root, ".ragmir", "storage"), { recursive: true })
    await writeFile(path.join(configured, "model.onnx"), "x".repeat(4096))
    await writeFile(path.join(models, "chat", "gemma.gguf"), "x".repeat(8192))
    const config = testConfig(root)

    const orphans = await findStorageOrphans(config)

    expect(orphans.map((orphan) => path.relative(root, orphan.path)).sort()).toEqual([
      path.join(".ragmir", "models", "chat", "gemma.gguf"),
      path.join(".ragmir", "models", "mixedbread-ai", "mxbai-embed-xsmall-v1"),
      path.join(".ragmir", "reports"),
      path.join(".ragmir", "storage-2.12-test"),
    ])
    expect(orphans.find((orphan) => orphan.path.endsWith("gemma.gguf"))?.reason).toContain(
      "retired Ragmir package",
    )
    expect(await diskUsage(configured)).toBeGreaterThanOrEqual(4096)

    await removeStorageOrphans(orphans)
    expect(existsSync(path.join(models, "chat", "gemma.gguf"))).toBe(false)
    expect(existsSync(configured)).toBe(true)
  })
})

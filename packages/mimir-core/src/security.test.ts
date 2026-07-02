import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { initProject } from "./init.js"
import { securityAudit } from "./security.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("securityAudit", () => {
  it("warns when remote Transformers.js model loading is enabled", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-security-"))
    tempDirs.push(root)
    await initProject(root)
    await writeFile(
      path.join(root, ".mimir", "config.json"),
      `${JSON.stringify(
        {
          embeddingProvider: "transformers",
          transformersAllowRemoteModels: true,
        },
        null,
        2,
      )}\n`,
      "utf8",
    )

    const report = await securityAudit(root)

    expect(report.providers.embedding).toBe("transformers")
    expect(report.providers.transformersAllowRemoteModels).toBe(true)
    expect(report.warnings).toContain(
      "Transformers remote model loading is enabled; model files can be downloaded from Hugging Face.",
    )
  })

  it("reports missing generated-state gitignore entries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-security-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".mimir"), { recursive: true })
    await writeFile(path.join(root, ".mimir", "config.json"), "{}\n", "utf8")
    await writeFile(path.join(root, ".gitignore"), "", "utf8")

    const report = await securityAudit(root)

    expect(report.gitignore.legacyKbIgnored).toBe(false)
    expect(report.gitignore.mimirIgnored).toBe(false)
    expect(report.gitignore.legacyPrivateIgnored).toBe(false)
    expect(report.warnings).toContain(".mimir/ is not ignored by Git.")
    expect(report.warnings).not.toContain(".kb/ is not ignored by Git.")
    expect(report.warnings).not.toContain("private/ is not ignored by Git.")
  })

  it("keeps legacy .kb and private warnings when a legacy config uses those paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-security-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".kb"), { recursive: true })
    await writeFile(path.join(root, ".kb", "config.json"), "{}\n", "utf8")
    await writeFile(path.join(root, ".gitignore"), ".mimir/\n", "utf8")

    const report = await securityAudit(root)

    expect(report.gitignore.mimirIgnored).toBe(true)
    expect(report.warnings).toContain(".kb/ is not ignored by Git.")
    expect(report.warnings).toContain("private/ is not ignored by Git.")
  })

  it("accepts legacy private/** gitignore entries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-security-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".kb"), { recursive: true })
    await writeFile(path.join(root, ".kb", "config.json"), "{}\n", "utf8")
    await writeFile(path.join(root, ".gitignore"), ".mimir/\n.kb/\nprivate/**\n", "utf8")

    const report = await securityAudit(root)

    expect(report.gitignore.legacyPrivateIgnored).toBe(true)
    expect(report.warnings).not.toContain("private/ is not ignored by Git.")
  })

  it("warns when redaction is disabled", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-security-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".mimir"), { recursive: true })
    await writeFile(
      path.join(root, ".mimir", "config.json"),
      JSON.stringify({ redaction: { enabled: false } }),
      "utf8",
    )

    const report = await securityAudit(root)

    expect(report.redaction.enabled).toBe(false)
    expect(report.warnings).toContain(
      "Redaction is disabled; secrets and identifiers may be embedded in the index.",
    )
  })

  it("detects whether the storage directory is git-ignored", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-security-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".mimir"), { recursive: true })
    await writeFile(path.join(root, ".mimir", "config.json"), "{}\n", "utf8")
    await writeFile(path.join(root, ".gitignore"), "node_modules/\n", "utf8")

    expect((await securityAudit(root)).storage.gitIgnored).toBe(false)

    await writeFile(path.join(root, ".gitignore"), ".mimir/\n", "utf8")

    expect((await securityAudit(root)).storage.gitIgnored).toBe(true)
  })
})

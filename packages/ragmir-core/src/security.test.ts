import { execFile } from "node:child_process"
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises"
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
  it("should stop security checks when the signal is already aborted", async () => {
    const controller = new AbortController()
    controller.abort("cancelled by caller")

    await expect(securityAudit(process.cwd(), { signal: controller.signal })).rejects.toMatchObject(
      { code: "ABORTED", retryable: true },
    )
  })

  it("warns when remote Transformers.js model loading is enabled", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-security-"))
    tempDirs.push(root)
    await initProject(root)
    await writeFile(
      path.join(root, ".ragmir", "config.json"),
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
    expect(report.mcp.maxOutputBytes).toBe(32_768)
    expect(report.warnings).toContain(
      "Transformers remote model loading is enabled; model files can be downloaded from Hugging Face.",
    )
  })

  it("reports missing generated-state gitignore entries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-security-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "config.json"), "{}\n", "utf8")
    await writeFile(path.join(root, ".gitignore"), "", "utf8")

    const report = await securityAudit(root)

    expect(report.gitignore.legacyKbIgnored).toBe(false)
    expect(report.gitignore.ragmirIgnored).toBe(false)
    expect(report.gitignore.legacyPrivateIgnored).toBe(false)
    expect(report.warnings).toContain(".ragmir/ is not ignored by Git.")
    expect(report.warnings).not.toContain(".kb/ is not ignored by Git.")
    expect(report.warnings).not.toContain("private/ is not ignored by Git.")
  })

  it("keeps legacy .kb and private warnings when a legacy config uses those paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-security-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".kb"), { recursive: true })
    await writeFile(path.join(root, ".kb", "config.json"), "{}\n", "utf8")
    await writeFile(path.join(root, ".gitignore"), ".ragmir/\n", "utf8")

    const report = await securityAudit(root)

    expect(report.gitignore.ragmirIgnored).toBe(true)
    expect(report.warnings).toContain(".kb/ is not ignored by Git.")
    expect(report.warnings).toContain("private/ is not ignored by Git.")
  })

  it("accepts legacy private/** gitignore entries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-security-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".kb"), { recursive: true })
    await writeFile(path.join(root, ".kb", "config.json"), "{}\n", "utf8")
    await writeFile(path.join(root, ".gitignore"), ".ragmir/\n.kb/\nprivate/**\n", "utf8")

    const report = await securityAudit(root)

    expect(report.gitignore.legacyPrivateIgnored).toBe(true)
    expect(report.warnings).not.toContain("private/ is not ignored by Git.")
  })

  it("warns when redaction is disabled", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-security-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir", "config.json"),
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
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-security-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "config.json"), "{}\n", "utf8")
    await writeFile(path.join(root, ".gitignore"), "node_modules/\n", "utf8")

    expect((await securityAudit(root)).storage.gitIgnored).toBe(false)

    await writeFile(path.join(root, ".gitignore"), ".ragmir/\n", "utf8")

    expect((await securityAudit(root)).storage.gitIgnored).toBe(true)
  })

  it("warns for custom storage and access log paths that Git does not ignore", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-security-custom-paths-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir", "config.json"),
      JSON.stringify({ storageDir: "generated/index", accessLogPath: "generated/access.log" }),
    )
    await writeFile(path.join(root, ".gitignore"), ".ragmir/\n", "utf8")

    const report = await securityAudit(root)

    expect(report.warnings).toContain("The configured storageDir is not ignored by Git.")
    expect(report.warnings).toContain("The configured accessLogPath is not ignored by Git.")
  })

  it("respects Git glob negations for configured storage paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-security-gitignore-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    await mkdir(path.join(root, "generated", "index"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir", "config.json"),
      JSON.stringify({ storageDir: "generated/index", accessLog: false }),
    )
    await runGit(root, ["init", "--quiet"])
    await writeFile(
      path.join(root, ".gitignore"),
      ".ragmir/\ngenerated/*\n!generated/index/\n",
      "utf8",
    )

    expect((await securityAudit(root)).storage.gitIgnored).toBe(false)

    await writeFile(path.join(root, ".gitignore"), ".ragmir/\ngenerated/**\n", "utf8")

    expect((await securityAudit(root)).storage.gitIgnored).toBe(true)
  })

  it.runIf(process.platform !== "win32")(
    "warns about permissive legacy config modes and repairs them during init",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-security-permissions-"))
      tempDirs.push(root)
      await initProject(root)
      const configPath = path.join(root, ".ragmir", "config.json")
      await chmod(configPath, 0o644)

      const before = await securityAudit(root)

      expect(before.permissions.checked).toBe(true)
      expect(before.permissions.configPrivate).toBe(false)
      expect(before.warnings).toContain(
        "The Ragmir config file is readable or writable by group/other users; restrict it to owner-only permissions or run `rgr doctor --fix` for Ragmir-owned default paths.",
      )

      await initProject(root)

      const after = await securityAudit(root)
      expect(after.permissions.configPrivate).toBe(true)
      expect((await stat(configPath)).mode & 0o777).toBe(0o600)
    },
  )
})

function runGit(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, windowsHide: true }, (error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

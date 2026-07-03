import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { detectPackageManager, kbCommand, ragmirCommand } from "./package-manager.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("package manager detection", () => {
  it("defaults to pnpm when no project signal exists", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-pm-"))
    tempDirs.push(root)

    expect(await detectPackageManager(root)).toBe("pnpm")
    await expect(ragmirCommand(root, ["doctor"])).resolves.toMatchObject({
      command: "pnpm",
      args: ["exec", "ragmir", "doctor"],
      display: "pnpm exec ragmir doctor",
    })
  })

  it("prefers package.json packageManager over lockfiles", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-pm-"))
    tempDirs.push(root)
    await writeFile(path.join(root, "package.json"), '{"packageManager":"npm@11.0.0"}\n', "utf8")
    await writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: 9.0\n", "utf8")

    expect(await detectPackageManager(root)).toBe("npm")
    await expect(ragmirCommand(root, ["serve-mcp"])).resolves.toMatchObject({
      command: "npx",
      args: ["ragmir", "serve-mcp"],
      display: "npx ragmir serve-mcp",
    })
  })

  it("detects bun and yarn lockfiles", async () => {
    const bunRoot = await mkdtemp(path.join(os.tmpdir(), "ragmir-pm-"))
    const yarnRoot = await mkdtemp(path.join(os.tmpdir(), "ragmir-pm-"))
    tempDirs.push(bunRoot, yarnRoot)
    await writeFile(path.join(bunRoot, "bun.lock"), "\n", "utf8")
    await writeFile(path.join(yarnRoot, "yarn.lock"), "\n", "utf8")

    expect(await detectPackageManager(bunRoot)).toBe("bun")
    expect(await detectPackageManager(yarnRoot)).toBe("yarn")
  })

  it("keeps kbCommand as a legacy compatibility alias", () => {
    expect(kbCommand).toBe(ragmirCommand)
  })
})

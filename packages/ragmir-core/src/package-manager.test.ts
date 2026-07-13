import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { detectPackageManager, kbCommand, ragmirCommand, rgrCommand } from "./package-manager.js"

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
    await expect(rgrCommand(root, ["doctor"])).resolves.toMatchObject({
      command: "pnpm",
      args: ["exec", "rgr", "doctor"],
      display: "pnpm exec rgr doctor",
    })
  })

  it("prefers package.json packageManager over lockfiles", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-pm-"))
    tempDirs.push(root)
    await writeFile(path.join(root, "package.json"), '{"packageManager":"npm@11.0.0"}\n', "utf8")
    await writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: 9.0\n", "utf8")

    expect(await detectPackageManager(root)).toBe("npm")
    await expect(rgrCommand(root, ["serve-mcp"])).resolves.toMatchObject({
      command: "npx",
      args: ["rgr", "serve-mcp"],
      display: "npx rgr serve-mcp",
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

  it("prefers the generated project runner when it exists", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-pm-"))
    tempDirs.push(root)
    const runnerPath = path.join(root, ".ragmir", "run.cjs")
    await mkdir(path.dirname(runnerPath), { recursive: true })
    await writeFile(runnerPath, "", "utf8")

    await expect(rgrCommand(root, ["doctor"])).resolves.toMatchObject({
      command: "node",
      args: [runnerPath, "doctor"],
      display: "node .ragmir/run.cjs doctor",
    })
  })

  it("keeps existing command helpers as compatibility aliases", () => {
    expect(ragmirCommand).toBe(rgrCommand)
    expect(kbCommand).toBe(rgrCommand)
  })
})

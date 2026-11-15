import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  detectPackageManager,
  isGlobalInstall,
  kbCommand,
  ragmirCommand,
  rgrCommand,
} from "./package-manager.js"
import { VERSION } from "./version.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

async function writeInstalledPackage(root: string, name: string): Promise<void> {
  const packageDir = path.join(root, "node_modules", "@jcode.labs", "ragmir")
  await mkdir(packageDir, { recursive: true })
  await writeFile(path.join(packageDir, "package.json"), `${JSON.stringify({ name })}\n`, "utf8")
}

describe("package manager detection", () => {
  it("names the pinned release when the project has no Ragmir install", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-pm-"))
    tempDirs.push(root)
    await writeInstalledPackage(root, "another-package")

    expect(await detectPackageManager(root)).toBe("pnpm")
    await expect(rgrCommand(root, ["search", "release approvals"])).resolves.toMatchObject({
      command: "npx",
      args: ["--yes", `@jcode.labs/ragmir@${VERSION}`, "search", "release approvals"],
      display: `npx --yes @jcode.labs/ragmir@${VERSION} search "release approvals"`,
    })
  })

  it("recognizes npm's global folder next to Node.js, as in the official Docker image", () => {
    const node = path.resolve("/usr/local/bin/node")
    const global = path.resolve("/usr/local/lib/node_modules/@jcode.labs/ragmir")
    const npxCache = path.resolve("/home/dev/.npm/_npx/4f1c/node_modules/@jcode.labs/ragmir")

    expect(isGlobalInstall(global, node)).toBe(true)
    expect(isGlobalInstall(npxCache, node)).toBe(false)
    expect(isGlobalInstall(path.resolve("/srv/app/node_modules/@jcode.labs/ragmir"), node)).toBe(
      false,
    )
    // The tests run from the repository checkout, which is no global install.
    expect(isGlobalInstall()).toBe(false)
  })

  it("runs the package manager when node_modules above the project holds Ragmir", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-pm-"))
    tempDirs.push(root)
    await writeInstalledPackage(root, "@jcode.labs/ragmir")
    const app = path.join(root, "apps", "web")
    await mkdir(app, { recursive: true })

    await expect(rgrCommand(app, ["doctor"])).resolves.toMatchObject({
      command: "pnpm",
      args: ["exec", "rgr", "doctor"],
      display: "pnpm exec rgr doctor",
    })
  })

  it("prefers package.json packageManager over lockfiles", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-pm-"))
    tempDirs.push(root)
    await writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify({
        packageManager: "npm@11.0.0",
        devDependencies: { "@jcode.labs/ragmir": "^6.12.0" },
      })}\n`,
      "utf8",
    )
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

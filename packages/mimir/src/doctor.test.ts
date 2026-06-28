import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { doctor } from "./doctor.js"
import { initProject } from "./init.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("doctor", () => {
  it("reports setup state and actionable next steps", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-doctor-"))
    tempDirs.push(root)

    const uninitialized = await doctor(root)
    expect(uninitialized.initialized).toBe(false)
    expect(uninitialized.ready).toBe(false)
    expect(uninitialized.packageManager).toBe("pnpm")
    expect(uninitialized.agentKitInstalled).toBe(false)
    expect(uninitialized.nextSteps).toEqual([
      "Run `pnpm exec kb setup` to initialize Mimir and install the agent kit.",
    ])

    await initProject(root)
    const initialized = await doctor(root)
    expect(initialized.initialized).toBe(true)
    expect(initialized.supportedFiles).toBe(0)
    expect(initialized.nextSteps).toEqual([
      "Add supported files under private/ or list extra source paths in .kb/sources.txt.",
    ])

    await mkdir(path.join(root, "private"), { recursive: true })
    await writeFile(path.join(root, "private", "evidence.md"), "Local evidence.\n", "utf8")
    const withEvidence = await doctor(root)
    expect(withEvidence.supportedFiles).toBe(1)
    expect(withEvidence.chunksIndexed).toBe(0)
    expect(withEvidence.nextSteps).toContain(
      "Run `pnpm exec kb doctor --fix` to rebuild stale or missing index data.",
    )
  })
})

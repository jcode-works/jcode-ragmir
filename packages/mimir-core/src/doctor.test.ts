import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { doctor } from "./doctor.js"
import { ingest } from "./ingest.js"
import { initProject } from "./init.js"
import { installSkill } from "./skill.js"

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
      "Run `pnpm exec mimir setup` to initialize Mimir and install the agent kit.",
    ])

    await initProject(root)
    const initialized = await doctor(root)
    expect(initialized.initialized).toBe(true)
    expect(initialized.supportedFiles).toBe(0)
    expect(initialized.nextSteps).toEqual([
      'Add supported files under .mimir/raw/ or list extra source paths in the "sources" array of .mimir/config.json.',
    ])

    await mkdir(path.join(root, ".mimir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".mimir", "raw", "evidence.md"), "Local evidence.\n", "utf8")
    const withEvidence = await doctor(root)
    expect(withEvidence.supportedFiles).toBe(1)
    expect(withEvidence.chunksIndexed).toBe(0)
    expect(withEvidence.nextSteps).toContain(
      "Run `pnpm exec mimir doctor --fix` to rebuild stale or missing index data.",
    )
  })

  it("recommends the semantic setup shortcut after the index is ready", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-doctor-"))
    tempDirs.push(root)

    await initProject(root)
    await writeFile(path.join(root, ".mimir", "raw", "evidence.md"), "Local evidence.\n", "utf8")
    await ingest({ cwd: root })
    const ready = await doctor(root)

    expect(ready.nextSteps).toContain(
      "For natural-language Q&A, run `pnpm exec mimir models pull --enable`, then run `pnpm exec mimir ingest --rebuild`.",
    )
  })

  it("detects an installed agent kit from the files installSkill writes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-doctor-kit-"))
    tempDirs.push(root)
    await initProject(root)

    expect((await doctor(root)).agentKitInstalled).toBe(false)

    await installSkill({ cwd: root })

    expect((await doctor(root)).agentKitInstalled).toBe(true)
  })
})

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { doctor } from "./doctor.js"
import { ingest } from "./ingest.js"
import { initProject } from "./init.js"
import { installAgentSkills, installSkill } from "./skill.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("doctor", () => {
  it("should stop diagnostics when the signal is already aborted", async () => {
    const controller = new AbortController()
    controller.abort("cancelled by caller")

    await expect(doctor(process.cwd(), { signal: controller.signal })).rejects.toMatchObject({
      code: "ABORTED",
      retryable: true,
    })
  })

  it("reports setup state and actionable next steps", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-doctor-"))
    tempDirs.push(root)

    const uninitialized = await doctor(root)
    expect(uninitialized.initialized).toBe(false)
    expect(uninitialized.ready).toBe(false)
    expect(uninitialized.packageManager).toBe("pnpm")
    expect(uninitialized.agentKitInstalled).toBe(false)
    expect(uninitialized.agentIntegration.ready).toBe(false)
    expect(uninitialized.nextSteps).toEqual([
      "Run `pnpm exec rgr setup` to initialize Ragmir and install the agent kit.",
    ])

    await initProject(root)
    const initialized = await doctor(root)
    expect(initialized.initialized).toBe(true)
    expect(initialized.supportedFiles).toBe(0)
    expect(initialized.nextSteps).toEqual([
      'Add supported files under .ragmir/raw/ or list extra source paths in the "sources" array of .ragmir/config.json.',
    ])

    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "raw", "evidence.md"), "Local evidence.\n", "utf8")
    const withEvidence = await doctor(root)
    expect(withEvidence.supportedFiles).toBe(1)
    expect(withEvidence.chunksIndexed).toBe(0)
    expect(withEvidence.nextSteps).toContain(
      "Run `pnpm exec rgr doctor --fix` to rebuild stale or missing index data.",
    )
  }, 15_000)

  it("recommends the semantic setup shortcut after the index is ready", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-doctor-"))
    tempDirs.push(root)

    await initProject(root)
    await writeFile(path.join(root, ".ragmir", "raw", "evidence.md"), "Local evidence.\n", "utf8")
    await ingest({ cwd: root })
    const ready = await doctor(root)

    expect(ready.nextSteps).toContain(
      "For natural-language Q&A, run `pnpm exec rgr models pull --enable`, then run `pnpm exec rgr ingest --rebuild`.",
    )
    expect(ready.indexFreshness.manifestFound).toBe(true)
    expect(ready.indexFreshness.warning).toBeNull()
    expect(ready.readiness).toEqual(
      expect.objectContaining({
        operationalReady: true,
        indexPolicyCurrent: true,
        privacyCompliant: true,
        retrievalQualityVerified: false,
      }),
    )
  })

  it("detects an installed agent kit from the files installSkill writes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-doctor-kit-"))
    tempDirs.push(root)
    await initProject(root)

    expect((await doctor(root)).agentKitInstalled).toBe(false)

    await installSkill({ cwd: root })

    const kitOnly = await doctor(root)
    expect(kitOnly.agentKitInstalled).toBe(true)
    expect(["installed-package", "npm-cache"]).toContain(kitOnly.agentIntegration.runnerMode)
    expect(kitOnly.agentIntegration.projectAgents).toEqual([])
    expect(kitOnly.agentIntegration.ready).toBe(
      kitOnly.agentIntegration.runnerReady && kitOnly.agentIntegration.nativeAgents.length > 0,
    )

    await installAgentSkills({ cwd: root, agents: ["codex"] })
    const integrated = await doctor(root)
    expect(integrated.agentIntegration.projectAgents).toContain("codex")
    expect(integrated.agentIntegration.ready).toBe(integrated.agentIntegration.runnerReady)
  }, 15_000)

  it("does not report complete coverage when a supported file yields no text", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-doctor-empty-"))
    tempDirs.push(root)
    await initProject(root)
    await writeFile(path.join(root, ".ragmir", "raw", "evidence.md"), "Indexed evidence.\n")
    await writeFile(path.join(root, ".ragmir", "raw", "empty.md"), "   \n")
    await ingest({ cwd: root })

    const report = await doctor(root)

    expect(report.emptyTextFiles).toBe(1)
    expect(report.readiness.coverageComplete).toBe(false)
    expect(report.ready).toBe(false)
    expect(report.nextSteps.some((step) => step.includes("produced no indexable text"))).toBe(true)
  })
})

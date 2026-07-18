import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { loadConfig } from "./config.js"
import { ingest } from "./ingest.js"
import { initProject } from "./init.js"
import { readIndexManifest, writeIndexManifest } from "./store.js"
import {
  compareTeamSnapshots,
  createTeamSnapshot,
  readTeamSnapshot,
  writeTeamSnapshot,
} from "./team-diagnostics.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("team diagnostics", () => {
  it("should report synchronization when ready indexes contain identical relative paths and bytes", async () => {
    const [localRoot, peerRoot] = await teamRoots()
    await Promise.all([
      writeEvidence(localRoot, "decision.md", "Approved release train.\n"),
      writeEvidence(peerRoot, "decision.md", "Approved release train.\n"),
    ])
    await Promise.all([ingest({ cwd: localRoot }), ingest({ cwd: peerRoot })])

    const comparison = compareTeamSnapshots(
      await createTeamSnapshot({ cwd: localRoot, label: "Alice" }),
      await createTeamSnapshot({ cwd: peerRoot, label: "Christophe" }),
    )

    expect(comparison).toMatchObject({
      status: "synchronized",
      synchronized: true,
      sameConfiguration: true,
      sameCorpus: true,
      authorityDecisionRequired: false,
      files: { localOnly: [], peerOnly: [], changed: [] },
      recommendedActions: [],
    })
  })

  it("should explain added, missing, and changed files without choosing an authority", async () => {
    const [localRoot, peerRoot] = await teamRoots()
    await Promise.all([
      writeEvidence(localRoot, "shared.md", "Local wording.\n"),
      writeEvidence(peerRoot, "shared.md", "Peer wording.\n"),
      writeEvidence(localRoot, "local-only.md", "Local evidence.\n"),
      writeEvidence(peerRoot, "peer-only.md", "Peer evidence.\n"),
    ])
    await Promise.all([ingest({ cwd: localRoot }), ingest({ cwd: peerRoot })])

    const comparison = compareTeamSnapshots(
      await createTeamSnapshot({ cwd: localRoot, label: "Alice" }),
      await createTeamSnapshot({ cwd: peerRoot, label: "Christophe" }),
    )

    expect(comparison.status).toBe("corpus-mismatch")
    expect(comparison.files.localOnly).toEqual([".ragmir/raw/local-only.md"])
    expect(comparison.files.peerOnly).toEqual([".ragmir/raw/peer-only.md"])
    expect(comparison.files.changed).toEqual([
      expect.objectContaining({ relativePath: ".ragmir/raw/shared.md" }),
    ])
    expect(comparison.authorityDecisionRequired).toBe(true)
    expect(comparison.recommendedActions.join(" ")).toContain("never guesses")
    expect(comparison.recommendedActions.join(" ")).toContain("rgr ingest")
  })

  it("should omit source text and absolute paths when writing a bounded shareable snapshot", async () => {
    const [root] = await teamRoots()
    const secretText = "Internal decision that must not appear in the snapshot."
    await writeEvidence(root, "private.md", `${secretText}\n`)
    await ingest({ cwd: root })
    const output = path.join(root, ".ragmir", "team", "alice.json")

    await writeTeamSnapshot(await createTeamSnapshot({ cwd: root, label: "Alice" }), output)
    await chmod(output, 0o600)
    const serialized = await readFile(output, "utf8")
    const parsed = await readTeamSnapshot(output)

    expect(parsed.label).toBe("Alice")
    expect(parsed.corpus.files).toHaveLength(1)
    expect(serialized).not.toContain(secretText)
    expect(serialized).not.toContain(root)
    expect(serialized).toContain(".ragmir/raw/private.md")
  })

  it("should compare external team folders without exposing machine-specific roots", async () => {
    const [localRoot, peerRoot] = await teamRoots()
    const localExternal = await mkdtemp(path.join(os.tmpdir(), "ragmir-team-drive-local-"))
    const peerExternal = await mkdtemp(path.join(os.tmpdir(), "ragmir-team-drive-peer-"))
    tempDirs.push(localExternal, peerExternal)
    await Promise.all([
      writeFile(path.join(localExternal, "decision.md"), "Shared Drive decision.\n", "utf8"),
      writeFile(path.join(peerExternal, "decision.md"), "Shared Drive decision.\n", "utf8"),
      writeFile(
        path.join(localRoot, ".ragmir", "config.json"),
        `${JSON.stringify({ sources: [localExternal] }, null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        path.join(peerRoot, ".ragmir", "config.json"),
        `${JSON.stringify({ sources: [peerExternal] }, null, 2)}\n`,
        "utf8",
      ),
    ])
    await Promise.all([ingest({ cwd: localRoot }), ingest({ cwd: peerRoot })])

    const local = await createTeamSnapshot({ cwd: localRoot, label: "Alice" })
    const peer = await createTeamSnapshot({ cwd: peerRoot, label: "Christophe" })
    const serialized = JSON.stringify(local)
    const comparison = compareTeamSnapshots(local, peer)

    expect(local.configuration.sources).toEqual(["<external-source-1>"])
    expect(local.corpus.files).toEqual([
      expect.objectContaining({ relativePath: "<external-source-1>/decision.md" }),
    ])
    expect(serialized).not.toContain(localRoot)
    expect(serialized).not.toContain(localExternal)
    expect(comparison).toMatchObject({
      status: "synchronized",
      sameConfiguration: true,
      sameCorpus: true,
    })
  })

  it("should synchronize operational indexes while surfacing privacy advisories", async () => {
    const [root] = await teamRoots()
    await writeEvidence(root, "decision.md", "Approved release train.\n")
    await ingest({ cwd: root })
    const config = await loadConfig(root)
    const manifest = await readIndexManifest(config)
    if (!manifest?.health) {
      throw new Error("Expected an index health snapshot.")
    }
    const warning = "A configured local extractor executes with operator authority."
    await writeIndexManifest(
      {
        ...manifest,
        health: { ...manifest.health, securityWarnings: [warning] },
      },
      config,
      manifest.indexedFiles,
    )

    const snapshot = await createTeamSnapshot({ cwd: root, label: "Alice" })
    const legacySnapshot = { ...snapshot, runtimeRagmirVersion: "2.19.2", ready: false }
    const comparison = compareTeamSnapshots(legacySnapshot, legacySnapshot)
    const currentNotReadyComparison = compareTeamSnapshots(
      { ...snapshot, ready: false },
      { ...snapshot, ready: false },
    )

    expect(snapshot).toMatchObject({ ready: true, health: { securityWarnings: 1 } })
    expect(comparison).toMatchObject({
      status: "synchronized",
      synchronized: true,
      securityAdvisories: { local: 1, peer: 1 },
    })
    expect(comparison.summary).toContain("non-blocking security advisories")
    expect(comparison.recommendedActions).toEqual([
      "On Alice, review 1 non-blocking security advisory with `rgr security-audit`.",
    ])
    expect(currentNotReadyComparison).toMatchObject({ status: "not-ready", synchronized: false })
  })

  it("should reject a snapshot when its file inventory was altered", async () => {
    const [root] = await teamRoots()
    await writeEvidence(root, "decision.md", "Approved release train.\n")
    await ingest({ cwd: root })
    const snapshot = await createTeamSnapshot({ cwd: root, label: "Alice" })
    const snapshotPath = path.join(root, "altered.json")
    snapshot.corpus.files[0].checksum = "0".repeat(64)
    await writeFile(snapshotPath, `${JSON.stringify(snapshot)}\n`, "utf8")

    await expect(readTeamSnapshot(snapshotPath)).rejects.toThrow("corpus fingerprint")
  })

  it("should reject a peer file when it does not match the snapshot schema", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-team-invalid-"))
    tempDirs.push(root)
    const snapshotPath = path.join(root, "peer.json")
    await writeFile(snapshotPath, '{"schemaVersion":1,"files":["../../secret"]}\n', "utf8")

    await expect(readTeamSnapshot(snapshotPath)).rejects.toThrow("does not match schema")
  })
})

async function teamRoots(): Promise<[string, string]> {
  const localRoot = await mkdtemp(path.join(os.tmpdir(), "ragmir-team-local-"))
  const peerRoot = await mkdtemp(path.join(os.tmpdir(), "ragmir-team-peer-"))
  tempDirs.push(localRoot, peerRoot)
  await Promise.all([initProject(localRoot), initProject(peerRoot)])
  return [localRoot, peerRoot]
}

async function writeEvidence(root: string, filename: string, content: string): Promise<void> {
  await writeFile(path.join(root, ".ragmir", "raw", filename), content, "utf8")
}

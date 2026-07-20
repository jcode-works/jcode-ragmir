import { execFile } from "node:child_process"
import {
  appendFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { afterEach, describe, expect, it } from "vitest"
import { ingest } from "./ingest.js"
import { initProject } from "./init.js"
import { exportPortableKnowledgeBase, verifyPortableKnowledgeBase } from "./portable.js"
import { search } from "./query.js"

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []

afterEach(async () => {
  for (const directory of tempDirs.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

describe("portable knowledge bases", () => {
  it("should export, move, verify, configure, and query a frozen knowledge base", async () => {
    const parent = await trackedTempDir("ragmir-portable-")
    const sourceRoot = await createIndexedProject(parent)
    const outputDir = path.join(parent, "exported-knowledge")

    const exported = await exportPortableKnowledgeBase({
      cwd: sourceRoot,
      outputDir,
      name: "Operations evidence",
    })

    expect(exported.outputDir).toBe(outputDir)
    expect(exported.previousOutputDir).toBeNull()
    expect(exported.verification.valid).toBe(true)
    expect(exported.fileCount).toBeGreaterThan(10)
    expect(exported.embeddingModelIncluded).toBe(false)

    const manifest = JSON.parse(await readFile(exported.manifestPath, "utf8")) as {
      name: string
      contents: {
        rawSourcesIncluded: boolean
        indexedTextIncluded: boolean
        accessLogsIncluded: boolean
        skills: string[]
      }
    }
    expect(manifest.name).toBe("Operations evidence")
    expect(manifest.contents).toMatchObject({
      rawSourcesIncluded: false,
      indexedTextIncluded: true,
      accessLogsIncluded: false,
      skills: ["ragmir-portable", "ragmir-decision-evidence"],
    })
    expect(JSON.stringify(manifest)).not.toContain(sourceRoot)
    await expect(readFile(path.join(outputDir, ".ragmir", "raw", "policy.md"))).rejects.toThrow()

    const storageEntries = await readdir(path.join(outputDir, ".ragmir", "storage"))
    expect(storageEntries.some((entry) => entry.endsWith(".lance"))).toBe(true)
    expect(storageEntries).toContain("index-manifest.json")
    expect(storageEntries).not.toContain("generation-leases")
    expect(storageEntries).not.toContain("ingestion-state.json")
    expect(storageEntries).not.toContain("source-fingerprints.jsonl")
    expect(storageEntries).not.toContain("index-manifest.previous.json")

    const movedRoot = path.join(parent, "server", "knowledge")
    await mkdir(path.dirname(movedRoot), { recursive: true })
    await rename(outputDir, movedRoot)

    const verification = await verifyPortableKnowledgeBase(movedRoot)
    expect(verification.valid).toBe(true)
    expect(verification.errors).toEqual([])

    const results = await search("Who approves emergency production changes?", {
      cwd: movedRoot,
      topK: 1,
    })
    expect(results[0]?.text).toContain("release manager")
    expect(results[0]?.citation).toContain("policy.md")

    const configured = await execFileAsync(process.execPath, [
      path.join(movedRoot, "bin", "configure.cjs"),
      "generic",
    ])
    const genericConfig = JSON.parse(configured.stdout) as {
      mcpServers: { ragmir: { args: string[]; cwd: string; env: Record<string, string> } }
    }
    const canonicalMovedRoot = await realpath(movedRoot)
    expect(genericConfig.mcpServers.ragmir.cwd).toBe(canonicalMovedRoot)
    expect(genericConfig.mcpServers.ragmir.args[0]).toBe(
      path.join(canonicalMovedRoot, "bin", "rgr.cjs"),
    )
    expect(genericConfig.mcpServers.ragmir.env.RAGMIR_PROJECT_ROOT).toBe(canonicalMovedRoot)
    expect(genericConfig.mcpServers.ragmir.env.RAGMIR_PORTABLE_READ_ONLY).toBe("1")
    const openclawConfigured = await execFileAsync(process.execPath, [
      path.join(movedRoot, "bin", "configure.cjs"),
      "openclaw",
    ])
    const openclawConfig = JSON.parse(openclawConfigured.stdout) as {
      args: string[]
      cwd: string
      env: Record<string, string>
      toolFilter: { include: string[] }
    }
    expect(openclawConfig.cwd).toBe(canonicalMovedRoot)
    expect(openclawConfig.args).toEqual([
      path.join(canonicalMovedRoot, "bin", "rgr.cjs"),
      "serve-mcp",
    ])
    expect(openclawConfig.env.RAGMIR_PROJECT_ROOT).toBe(canonicalMovedRoot)
    expect(openclawConfig.env.RAGMIR_PORTABLE_READ_ONLY).toBe("1")
    expect(openclawConfig.toolFilter.include).toEqual([
      "ragmir_status",
      "ragmir_route_prompt",
      "ragmir_search",
      "ragmir_ask",
      "ragmir_expand",
    ])
    await expect(
      readFile(path.join(movedRoot, "runtime", "dist", "portable-entry.js"), "utf8"),
    ).resolves.toContain("runPortableCli")
    await expect(
      readFile(
        path.join(movedRoot, "runtime", "node_modules", "@lancedb", "lancedb", "package.json"),
        "utf8",
      ),
    ).resolves.toContain("@lancedb/lancedb")
    await expect(
      readFile(
        path.join(
          movedRoot,
          "runtime",
          "node_modules",
          "@modelcontextprotocol",
          "sdk",
          "node_modules",
          "express",
          "package.json",
        ),
        "utf8",
      ),
    ).rejects.toThrow()

    const cliResult = await execFileAsync(process.execPath, [
      path.join(movedRoot, "bin", "rgr.cjs"),
      "search",
      "emergency production approval",
      "--compact",
      "--json",
    ])
    expect(cliResult.stdout).toContain("release manager")

    const manifestPath = path.join(movedRoot, "manifest.json")
    const originalManifest = await readFile(manifestPath, "utf8")
    const incompatiblePlatform = process.platform === "darwin" ? "linux" : "darwin"
    const incompatibleManifest = JSON.parse(originalManifest) as {
      runtime: { exportedOn: { platform: string; arch: string } }
    }
    incompatibleManifest.runtime.exportedOn.platform = incompatiblePlatform
    try {
      await writeFile(manifestPath, `${JSON.stringify(incompatibleManifest)}\n`)
      await expect(
        execFileAsync(process.execPath, [
          path.join(movedRoot, "bin", "rgr.cjs"),
          "search",
          "emergency production approval",
        ]),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          `This bundle targets ${incompatiblePlatform}/${process.arch}`,
        ),
      })
    } finally {
      await writeFile(manifestPath, originalManifest)
    }

    const client = new Client({ name: "ragmir-portable-process-test", version: "1.0.0" })
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(movedRoot, "bin", "rgr.cjs"), "serve-mcp"],
      cwd: movedRoot,
      stderr: "pipe",
    })
    try {
      await client.connect(transport)
      const tools = await client.listTools()
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        "ragmir_ask",
        "ragmir_expand",
        "ragmir_route_prompt",
        "ragmir_search",
        "ragmir_status",
      ])
      const resources = await client.listResources()
      expect(resources.resources.map((resource) => resource.uri).sort()).toEqual([
        "ragmir://context",
        "ragmir://sources",
      ])
      const response = await client.callTool({
        name: "ragmir_search",
        arguments: { query: "emergency production approval", topK: 1 },
      })
      const content = response.content.find((item) => item.type === "text")
      expect(content?.type === "text" ? content.text : "").toContain("release manager")
    } finally {
      await client.close()
    }

    await expect(
      execFileAsync(process.execPath, [path.join(movedRoot, "bin", "rgr.cjs"), "ingest"]),
    ).rejects.toMatchObject({ stderr: expect.stringContaining("blocks index and source mutation") })
  }, 90_000)

  it("should use a private timestamped default destination", async () => {
    const parent = await trackedTempDir("ragmir-portable-default-")
    const sourceRoot = await createIndexedProject(parent)

    const result = await exportPortableKnowledgeBase({ cwd: sourceRoot, name: "Policy Base" })

    expect(result.outputDir).toMatch(
      new RegExp(`${escapeRegExp(path.join(sourceRoot, ".ragmir", "exports", "policy-base-"))}`),
    )
    expect(result.verification.valid).toBe(true)
  }, 90_000)

  it("should reject existing destinations and destinations overlapping managed data", async () => {
    const parent = await trackedTempDir("ragmir-portable-destination-")
    const sourceRoot = await createIndexedProject(parent)
    const existing = path.join(parent, "existing")
    await mkdir(existing)

    await expect(
      exportPortableKnowledgeBase({ cwd: sourceRoot, outputDir: existing }),
    ).rejects.toThrow("destination already exists")
    await expect(
      exportPortableKnowledgeBase({
        cwd: sourceRoot,
        outputDir: existing,
        replaceExisting: true,
      }),
    ).rejects.toThrow("Portable replacement refused")
    await expect(
      exportPortableKnowledgeBase({
        cwd: sourceRoot,
        outputDir: path.join(sourceRoot, ".ragmir", "storage", "export"),
      }),
    ).rejects.toThrow("must not overlap")
    await expect(
      exportPortableKnowledgeBase({
        cwd: sourceRoot,
        outputDir: path.join(sourceRoot, "portable-export"),
      }),
    ).rejects.toThrow("inside the project must stay under")
  })

  it("should preserve and replace an existing portable destination", async () => {
    const parent = await trackedTempDir("ragmir-portable-replace-")
    const sourceRoot = await createIndexedProject(parent)
    const outputDir = path.join(parent, "stable-knowledge")
    await exportPortableKnowledgeBase({ cwd: sourceRoot, outputDir })

    await writeFile(
      path.join(sourceRoot, ".ragmir", "raw", "policy.md"),
      "Emergency production changes require approval from the incident commander before deployment.\n",
    )
    await ingest({ cwd: sourceRoot })

    const updated = await exportPortableKnowledgeBase({
      cwd: sourceRoot,
      outputDir,
      replaceExisting: true,
    })
    if (!updated.previousOutputDir) {
      throw new Error("Expected the previous portable destination to be preserved.")
    }

    expect(updated.outputDir).toBe(outputDir)
    expect(updated.previousOutputDir).toMatch(new RegExp(`${escapeRegExp(outputDir)}\\.previous-`))
    expect((await verifyPortableKnowledgeBase(outputDir)).valid).toBe(true)
    expect((await verifyPortableKnowledgeBase(updated.previousOutputDir)).valid).toBe(true)

    const currentResults = await search("Who approves emergency production changes?", {
      cwd: outputDir,
      topK: 1,
    })
    const previousResults = await search("Who approves emergency production changes?", {
      cwd: updated.previousOutputDir,
      topK: 1,
    })
    expect(currentResults[0]?.text).toContain("incident commander")
    expect(previousResults[0]?.text).toContain("release manager")
  }, 90_000)

  it("should reject missing indexes and configured external extractors", async () => {
    const parent = await trackedTempDir("ragmir-portable-readiness-")
    const emptyRoot = path.join(parent, "empty")
    await initProject(emptyRoot)

    await expect(
      exportPortableKnowledgeBase({ cwd: emptyRoot, outputDir: path.join(parent, "empty-export") }),
    ).rejects.toThrow("no valid index")

    const sourceRoot = await createIndexedProject(parent, "configured")
    const configPath = path.join(sourceRoot, ".ragmir", "config.json")
    const config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>
    await writeFile(configPath, `${JSON.stringify({ ...config, pdfOcrCommand: ["pdftotext"] })}\n`)

    await expect(
      exportPortableKnowledgeBase({
        cwd: sourceRoot,
        outputDir: path.join(parent, "extractor-export"),
      }),
    ).rejects.toThrow("does not copy external extractor commands")

    const semanticRoot = await createIndexedProject(parent, "semantic")
    const semanticConfigPath = path.join(semanticRoot, ".ragmir", "config.json")
    const semanticConfig = JSON.parse(await readFile(semanticConfigPath, "utf8")) as Record<
      string,
      unknown
    >
    await writeFile(
      semanticConfigPath,
      `${JSON.stringify({
        ...semanticConfig,
        embeddingProvider: "transformers",
        embeddingModelDigest: null,
      })}\n`,
    )
    await expect(
      exportPortableKnowledgeBase({
        cwd: semanticRoot,
        outputDir: path.join(parent, "semantic-export"),
      }),
    ).rejects.toThrow("requires a verified embeddingModelDigest")
  })

  it("should report tampered managed files", async () => {
    const parent = await trackedTempDir("ragmir-portable-tamper-")
    const sourceRoot = await createIndexedProject(parent)
    const outputDir = path.join(parent, "export")
    await exportPortableKnowledgeBase({ cwd: sourceRoot, outputDir })

    await appendFile(path.join(outputDir, "README.md"), "tampered\n")
    const verification = await verifyPortableKnowledgeBase(outputDir)

    expect(verification.valid).toBe(false)
    expect(verification.errors).toContain("Size mismatch for README.md.")
  }, 90_000)
})

async function createIndexedProject(parent: string, name = "source"): Promise<string> {
  const root = path.join(parent, name)
  await initProject(root)
  await writeFile(
    path.join(root, ".ragmir", "raw", "policy.md"),
    "Emergency production changes require approval from the release manager before deployment.\n",
  )
  await ingest({ cwd: root })
  return root
}

async function trackedTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirs.push(directory)
  return directory
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}

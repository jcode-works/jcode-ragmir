import { existsSync } from "node:fs"
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { repairProject, setupProject } from "./setup.js"

vi.mock("@huggingface/transformers", async () => {
  const env: { cacheDir?: string; allowRemoteModels?: boolean } = {}
  return {
    env,
    // A remote pipeline caches the pinned revision under <cacheDir>/<model>/<revision>/.
    pipeline: async (_task: string, model: string, { revision }: { revision: string }) => {
      if (env.allowRemoteModels && env.cacheDir) {
        const snapshot = path.join(env.cacheDir, model, revision)
        await mkdir(path.join(snapshot, "onnx"), { recursive: true })
        await Promise.all([
          writeFile(path.join(snapshot, "config.json"), "{}\n"),
          writeFile(path.join(snapshot, "onnx", "model.onnx"), "test-model"),
          writeFile(path.join(snapshot, "tokenizer.json"), "{}\n"),
          writeFile(path.join(snapshot, "tokenizer_config.json"), "{}\n"),
        ])
      }
      return async () => ({})
    },
  }
})

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("setupProject", () => {
  it("initializes, installs the agent kit, and reports next steps without documents", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-setup-"))
    tempDirs.push(root)

    const result = await setupProject({ cwd: root })
    const mcpConfig = JSON.parse(await readFile(result.agentKit.mcpConfigPath, "utf8")) as {
      mcpServers: { ragmir: { command: string; args: string[] } }
    }

    expect(result.created).toContain(path.join(".ragmir", "config.json"))
    expect(result.doctor.initialized).toBe(true)
    expect(result.doctor.agentKitInstalled).toBe(true)
    expect(result.semantic).toBeNull()
    expect(result.ingested).toBeNull()
    expect(result.configurationPrompt).toContain("Set up Ragmir in this repository")
    expect(result.configurationPrompt).toContain("explain the proposed setup")
    expect(result.configurationPrompt).toContain("Default to offline local-hash")
    expect(result.configurationPrompt).toContain("@huggingface/transformers")
    expect(result.configurationPrompt).toContain("rgr upgrade --check")
    expect(result.configurationPrompt.length).toBeLessThanOrEqual(4_000)
    expect(mcpConfig.mcpServers.ragmir.command).toBe("node")
    expect(mcpConfig.mcpServers.ragmir.args).toEqual([result.agentKit.runnerPath, "serve-mcp"])
    expect(result.agentInstallations.map((installation) => installation.agent)).toEqual([
      "claude",
      "codex",
      "kimi",
      "opencode",
      "cline",
    ])
    expect(existsSync(path.join(root, ".agents", "skills", "ragmir", "SKILL.md"))).toBe(true)
    expect(result.doctor.agentIntegration.ready).toBe(result.doctor.agentIntegration.runnerReady)
    expect(["installed-package", "npm-cache"]).toContain(result.doctor.agentIntegration.runnerMode)
    expect(result.doctor.agentIntegration.projectAgents).toEqual([
      "claude",
      "codex",
      "kimi",
      "opencode",
      "cline",
    ])
  }, 15_000)

  it("can preload and enable semantic embeddings during setup", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-setup-semantic-"))
    tempDirs.push(root)

    const result = await setupProject({ cwd: root, ingest: false, semantic: true })
    const config = JSON.parse(
      await readFile(path.join(root, ".ragmir", "config.json"), "utf8"),
    ) as {
      embeddingProvider: string
      embeddingModelRevision: string
      embeddingModelDigest: string | null
      embeddingModelPath: string
      transformersAllowRemoteModels: boolean
    }

    expect(result.semantic).toMatchObject({
      model: {
        embeddingModel: "intfloat/multilingual-e5-small",
        embeddingModelRevision: expect.stringMatching(/^[0-9a-f]{40}$/u),
        embeddingModelDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        embeddingModelPath: path.join(root, ".ragmir/models"),
      },
      config: {
        embeddingProvider: "transformers",
        embeddingModelRevision: expect.stringMatching(/^[0-9a-f]{40}$/u),
        embeddingModelDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        embeddingModelPath: ".ragmir/models",
        transformersAllowRemoteModels: false,
      },
    })
    expect(config.embeddingProvider).toBe("transformers")
    expect(config.embeddingModelRevision).toMatch(/^[0-9a-f]{40}$/u)
    expect(config.embeddingModelDigest).toMatch(/^sha256:[0-9a-f]{64}$/u)
    expect(config.embeddingModelPath).toBe(".ragmir/models")
    expect(config.transformersAllowRemoteModels).toBe(false)
  }, 15_000)

  it("auto-ingests supported files when the privacy posture is clean", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-setup-"))
    tempDirs.push(root)
    await writeFile(path.join(root, "package.json"), '{"packageManager":"pnpm@11.9.0"}\n', "utf8")

    const first = await setupProject({ cwd: root, ingest: false })
    await writeFile(
      path.join(root, ".ragmir", "raw", "evidence.md"),
      "Useful local evidence.\n",
      "utf8",
    )
    const second = await setupProject({ cwd: root })

    expect(first.ingested).toBeNull()
    expect(second.ingested?.indexedFiles).toBe(1)
    expect(second.doctor.ready).toBe(true)
    expect(second.doctor.nextSteps).toContain(
      "Restart or reload the selected agents so they discover the installed Ragmir skills.",
    )
    expect(second.nextSteps).toContain(
      "Restart or reload the selected agents so they discover the installed Ragmir skills.",
    )
  }, 15_000)

  it("passes targeted MCP helper options to the generated agent kit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-setup-"))
    tempDirs.push(root)

    const result = await setupProject({
      cwd: root,
      ingest: false,
      agents: ["claude"],
      mcpServerName: "local-docs",
      mcpCommand: "./scripts/serve-mcp.sh",
    })
    const mcpConfig = JSON.parse(await readFile(result.agentKit.mcpConfigPath, "utf8")) as {
      mcpServers: Record<string, { command: string; args: string[] }>
    }

    expect(mcpConfig.mcpServers["local-docs"]?.command).toBe("./scripts/serve-mcp.sh")
    expect(mcpConfig.mcpServers["local-docs"]?.args).toEqual([])
    expect(result.agentKit.agentHelpers.map((helper) => helper.agent)).toEqual(["claude"])
    expect(result.agentInstallations.map((installation) => installation.agent)).toEqual(["claude"])
    expect(existsSync(path.join(root, ".claude", "skills", "ragmir", "SKILL.md"))).toBe(true)
    expect(existsSync(path.join(root, ".ragmir", "codex-mcp.toml"))).toBe(false)
    expect(existsSync(path.join(root, ".ragmir", "kimi-mcp.json"))).toBe(false)
  })
})

describe("repairProject", () => {
  it("keeps the agent integrations a project already exposes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-repair-agents-"))
    tempDirs.push(root)
    await setupProject({ cwd: root, ingest: false, agents: ["claude", "codex"] })

    const result = await repairProject({ cwd: root })

    expect(result.agentInstallations.map((installation) => installation.agent)).toEqual([
      "claude",
      "codex",
    ])
    for (const directory of [".kimi", ".opencode", ".cline"]) {
      expect(existsSync(path.join(root, directory))).toBe(false)
    }
    expect(await readFile(path.join(root, ".gitignore"), "utf8")).not.toContain(".kimi/")
  }, 15_000)

  it.skipIf(process.platform === "win32")(
    "restores owner-only permissions on Ragmir-owned paths",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-repair-permissions-"))
      tempDirs.push(root)
      await setupProject({ cwd: root, ingest: false, agents: ["claude"] })
      const modelPath = path.join(root, ".ragmir", "models")
      await mkdir(modelPath, { recursive: true })
      await chmod(modelPath, 0o755)
      await chmod(path.join(root, ".ragmir"), 0o755)

      const result = await repairProject({ cwd: root })

      expect((await stat(modelPath)).mode & 0o077).toBe(0)
      expect((await stat(path.join(root, ".ragmir"))).mode & 0o077).toBe(0)
      expect(result.doctor.securityWarnings.join("\n")).not.toContain("embeddingModelPath")
    },
    15_000,
  )
})

import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { setupProject } from "./setup.js"

vi.mock("@huggingface/transformers", () => ({
  env: {},
  pipeline: async () => async () => ({}),
}))

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
    expect(result.configurationPrompt).toContain("ask one concise numbered batch of questions")
    expect(result.configurationPrompt).toContain("Core only, or optional Chat")
    expect(result.configurationPrompt).toContain("Optional TTS")
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
    const modelRoot = path.join(root, ".ragmir", "models", "intfloat", "multilingual-e5-small")
    await mkdir(path.join(modelRoot, "onnx"), { recursive: true })
    await Promise.all([
      writeFile(path.join(modelRoot, "config.json"), "{}\n"),
      writeFile(path.join(modelRoot, "onnx", "model.onnx"), "test-model"),
      writeFile(path.join(modelRoot, "tokenizer.json"), "{}\n"),
    ])

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

import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { setupProject } from "./setup.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("setupProject", () => {
  it("initializes, installs the agent kit, and reports next steps without documents", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-setup-"))
    tempDirs.push(root)

    const result = await setupProject({ cwd: root })
    const mcpConfig = JSON.parse(await readFile(result.agentKit.mcpConfigPath, "utf8")) as {
      mcpServers: { mimir: { command: string; args: string[] } }
    }

    expect(result.created).toContain(path.join(".mimir", "config.json"))
    expect(result.doctor.initialized).toBe(true)
    expect(result.doctor.agentKitInstalled).toBe(true)
    expect(result.ingested).toBeNull()
    expect(mcpConfig.mcpServers.mimir.command).toBe("pnpm")
    expect(mcpConfig.mcpServers.mimir.args).toEqual(["exec", "mimir", "serve-mcp"])
  })

  it("auto-ingests supported files when the privacy posture is clean", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-setup-"))
    tempDirs.push(root)
    await writeFile(path.join(root, "package.json"), '{"packageManager":"pnpm@11.9.0"}\n', "utf8")

    const first = await setupProject({ cwd: root, ingest: false })
    await writeFile(
      path.join(root, ".mimir", "raw", "evidence.md"),
      "Useful local evidence.\n",
      "utf8",
    )
    const second = await setupProject({ cwd: root })

    expect(first.ingested).toBeNull()
    expect(second.ingested?.indexedFiles).toBe(1)
    expect(second.doctor.ready).toBe(true)
    expect(second.doctor.nextSteps).toContain(
      "Run `mimir install-agent --agents claude` or another targeted agent list for native skill discovery.",
    )
    expect(second.nextSteps).toContain(
      "Run `mimir install-agent --agents claude` or another targeted agent list for native skill discovery.",
    )
  })

  it("passes targeted MCP helper options to the generated agent kit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-setup-"))
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
    expect(existsSync(path.join(root, ".mimir", "codex-mcp.toml"))).toBe(false)
    expect(existsSync(path.join(root, ".mimir", "kimi-mcp.json"))).toBe(false)
  })
})

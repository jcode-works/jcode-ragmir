import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { installSkill } from "./skill.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("installSkill", () => {
  it("copies the bundled skill and writes an MCP config example", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-skill-"))
    tempDirs.push(root)

    const result = await installSkill({ cwd: root })
    const skill = await readFile(path.join(result.skillPath, "SKILL.md"), "utf8")
    const audioSkill = await readFile(path.join(result.audioSkillPath, "SKILL.md"), "utf8")
    const reportSkill = await readFile(path.join(result.reportSkillPath, "SKILL.md"), "utf8")
    const mcpConfig = JSON.parse(await readFile(result.mcpConfigPath, "utf8")) as {
      mcpServers: { mimir: { command: string; args: string[]; cwd: string } }
    }
    const claudeConfig = JSON.parse(await readFile(result.claudeConfigPath, "utf8")) as {
      type: string
      command: string
      args: string[]
    }
    const codexConfig = await readFile(result.codexConfigPath, "utf8")

    expect(skill).toContain("name: mimir")
    expect(audioSkill).toContain("name: mimir-audio-summary")
    expect(reportSkill).toContain("name: mimir-markdown-report")
    expect(mcpConfig.mcpServers.mimir.command).toBe("pnpm")
    expect(mcpConfig.mcpServers.mimir.args).toEqual(["exec", "kb", "serve-mcp"])
    expect(mcpConfig.mcpServers.mimir.cwd).toBe(root)
    expect(claudeConfig).toEqual({
      type: "stdio",
      command: "pnpm",
      args: ["exec", "kb", "serve-mcp"],
    })
    expect(codexConfig).toContain("[mcp_servers.mimir]")
    expect(codexConfig).toContain('command = "pnpm"')
    expect(codexConfig).toContain('args = ["exec", "kb", "serve-mcp"]')
    expect(codexConfig).toContain(`cwd = ${JSON.stringify(root)}`)
  })

  it("adds Mimir runtime folders to gitignore without duplicating entries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-skill-"))
    tempDirs.push(root)

    const first = await installSkill({ cwd: root })
    const second = await installSkill({ cwd: root })
    const gitignore = await readFile(path.join(root, ".gitignore"), "utf8")

    expect(first.written).toContain(".gitignore")
    expect(second.written).not.toContain(".gitignore")
    expect(first.written).toContain(path.join(".mimir", "skills", "mimir-audio-summary"))
    expect(first.written).toContain(path.join(".mimir", "skills", "mimir-markdown-report"))
    expect(first.written).toContain(path.join(".mimir", "claude-mcp-server.json"))
    expect(first.written).toContain(path.join(".mimir", "codex-mcp.toml"))
    expect(gitignore.match(/^\.kb\/$/gm)).toHaveLength(1)
    expect(gitignore.match(/^\.mimir\/$/gm)).toHaveLength(1)
  })

  it("uses the target repository package manager in generated MCP config", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-skill-"))
    tempDirs.push(root)
    await writeFile(path.join(root, "package-lock.json"), "{}\n", "utf8")

    const result = await installSkill({ cwd: root })
    const mcpConfig = JSON.parse(await readFile(result.mcpConfigPath, "utf8")) as {
      mcpServers: { mimir: { command: string; args: string[] } }
    }
    const codexConfig = await readFile(result.codexConfigPath, "utf8")
    const readme = await readFile(result.readmePath, "utf8")

    expect(mcpConfig.mcpServers.mimir.command).toBe("npx")
    expect(mcpConfig.mcpServers.mimir.args).toEqual(["kb", "serve-mcp"])
    expect(codexConfig).toContain('command = "npx"')
    expect(codexConfig).toContain('args = ["kb", "serve-mcp"]')
    expect(readme).toContain("npx kb serve-mcp")
  })
})

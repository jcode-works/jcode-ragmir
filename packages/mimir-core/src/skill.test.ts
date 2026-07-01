import { existsSync } from "node:fs"
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { installAgentSkills, installSkill, parseAgentTargets } from "./skill.js"

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
    const legalSkill = await readFile(path.join(result.legalSkillPath, "SKILL.md"), "utf8")
    const mcpConfig = JSON.parse(await readFile(result.mcpConfigPath, "utf8")) as {
      mcpServers: { mimir: { command: string; args: string[]; cwd: string } }
    }
    const claudeConfig = JSON.parse(await readFile(result.claudeConfigPath, "utf8")) as {
      type: string
      command: string
      args: string[]
    }
    const kimiConfig = JSON.parse(await readFile(result.kimiConfigPath, "utf8")) as {
      mcpServers: { mimir: { env: { MIMIR_PROJECT_ROOT: string } } }
    }
    const opencodeConfig = JSON.parse(await readFile(result.opencodeConfigPath, "utf8")) as {
      mcp: {
        mimir: {
          type: string
          command: string[]
          enabled: boolean
          environment: { MIMIR_PROJECT_ROOT: string }
        }
      }
    }
    const clineConfig = JSON.parse(await readFile(result.clineConfigPath, "utf8")) as {
      mcpServers: { mimir: { env: { MIMIR_PROJECT_ROOT: string } } }
    }
    const codexConfig = await readFile(result.codexConfigPath, "utf8")
    const agentSetup = await readFile(result.agentSetupPath, "utf8")

    expect(skill).toContain("name: mimir")
    expect(audioSkill).toContain("name: mimir-audio-summary")
    expect(reportSkill).toContain("name: mimir-markdown-report")
    expect(legalSkill).toContain("name: mimir-legal-dossier")
    expect(mcpConfig.mcpServers.mimir.command).toBe("pnpm")
    expect(mcpConfig.mcpServers.mimir.args).toEqual(["exec", "mimir", "serve-mcp"])
    expect(mcpConfig.mcpServers.mimir.cwd).toBe(root)
    expect(claudeConfig).toEqual({
      type: "stdio",
      command: "pnpm",
      args: ["exec", "mimir", "serve-mcp"],
    })
    expect(codexConfig).toContain("[mcp_servers.mimir]")
    expect(codexConfig).toContain('command = "pnpm"')
    expect(codexConfig).toContain('args = ["exec", "mimir", "serve-mcp"]')
    expect(codexConfig).toContain(`cwd = ${JSON.stringify(root)}`)
    expect(codexConfig).toContain("[[skills.config]]")
    expect(codexConfig).toContain(path.join(root, ".mimir", "skills", "mimir"))
    expect(codexConfig).toContain(path.join(root, ".mimir", "skills", "mimir-legal-dossier"))
    expect(kimiConfig.mcpServers.mimir.env.MIMIR_PROJECT_ROOT).toBe(root)
    expect(opencodeConfig.mcp.mimir).toEqual({
      type: "local",
      command: ["pnpm", "exec", "mimir", "serve-mcp"],
      enabled: true,
      environment: { MIMIR_PROJECT_ROOT: root },
    })
    expect(clineConfig.mcpServers.mimir.env.MIMIR_PROJECT_ROOT).toBe(root)
    expect(agentSetup).toContain("Claude Code")
    expect(agentSetup).toContain("Kimi Code CLI")
    expect(agentSetup).toContain("OpenCode")
    expect(agentSetup).toContain("Cline")
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
    expect(first.written).toContain(path.join(".mimir", "skills", "mimir-legal-dossier"))
    expect(first.written).toContain(path.join(".mimir", "claude-mcp-server.json"))
    expect(first.written).toContain(path.join(".mimir", "codex-mcp.toml"))
    expect(first.written).toContain(path.join(".mimir", "kimi-mcp.json"))
    expect(first.written).toContain(path.join(".mimir", "opencode.jsonc"))
    expect(first.written).toContain(path.join(".mimir", "cline-mcp.json"))
    expect(first.written).toContain(path.join(".mimir", "agent-setup.md"))
    expect(gitignore.match(/^\.mimir\/$/gm)).toHaveLength(1)
    expect(gitignore).not.toContain(".kb/")
    expect(gitignore).not.toContain("private/**")
    expect(gitignore).not.toContain("!private/")
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
    expect(mcpConfig.mcpServers.mimir.args).toEqual(["mimir", "serve-mcp"])
    expect(codexConfig).toContain('command = "npx"')
    expect(codexConfig).toContain('args = ["mimir", "serve-mcp"]')
    expect(readme).toContain("npx mimir serve-mcp")
  })

  it("can generate selected agent helpers with a custom MCP command", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-skill-"))
    tempDirs.push(root)

    await installSkill({ cwd: root })
    const result = await installSkill({
      cwd: root,
      agents: ["claude", "codex"],
      mcpServerName: "project-docs",
      mcpCommand: "./scripts/serve-mcp.sh",
      mcpArgs: ["--stdio"],
    })
    const mcpConfig = JSON.parse(await readFile(result.mcpConfigPath, "utf8")) as {
      mcpServers: Record<string, { command: string; args: string[]; cwd: string }>
    }
    const claudeConfig = JSON.parse(await readFile(result.claudeConfigPath, "utf8")) as {
      command: string
      args: string[]
    }
    const codexConfig = await readFile(result.codexConfigPath, "utf8")
    const readme = await readFile(result.readmePath, "utf8")

    expect(Object.keys(mcpConfig.mcpServers)).toEqual(["project-docs"])
    expect(mcpConfig.mcpServers["project-docs"]?.command).toBe("./scripts/serve-mcp.sh")
    expect(mcpConfig.mcpServers["project-docs"]?.args).toEqual(["--stdio"])
    expect(claudeConfig).toEqual({
      type: "stdio",
      command: "./scripts/serve-mcp.sh",
      args: ["--stdio"],
    })
    expect(codexConfig).toContain("[mcp_servers.project-docs]")
    expect(codexConfig).toContain('command = "./scripts/serve-mcp.sh"')
    expect(codexConfig).toContain('args = ["--stdio"]')
    expect(result.agentHelpers.map((helper) => helper.agent)).toEqual(["claude", "codex"])
    expect(result.written).toContain(path.join(".mimir", "claude-mcp-server.json"))
    expect(result.written).toContain(path.join(".mimir", "codex-mcp.toml"))
    expect(result.written).not.toContain(path.join(".mimir", "kimi-mcp.json"))
    expect(result.written).not.toContain(path.join(".mimir", "opencode.jsonc"))
    expect(result.written).not.toContain(path.join(".mimir", "cline-mcp.json"))
    expect(existsSync(path.join(root, ".mimir", "kimi-mcp.json"))).toBe(false)
    expect(existsSync(path.join(root, ".mimir", "opencode.jsonc"))).toBe(false)
    expect(existsSync(path.join(root, ".mimir", "cline-mcp.json"))).toBe(false)
    expect(readme).toContain("project-docs")
    expect(readme).toContain("./scripts/serve-mcp.sh --stdio")
    expect(readme).not.toContain("kimi --mcp-config-file")
  })
})

describe("installAgentSkills", () => {
  it("links selected skills into native project-scope agent folders by default", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-agent-"))
    tempDirs.push(root)

    const result = await installAgentSkills({
      cwd: root,
      agents: parseAgentTargets("claude,kimi"),
      scope: "project",
    })

    expect(result.installations.map((installation) => installation.agent)).toEqual([
      "claude",
      "kimi",
    ])
    expect(result.installations.map((installation) => installation.mode)).toEqual(["link", "link"])
    const claudeSkillDir = path.join(root, ".claude", "skills", "mimir")
    const kimiSkillDir = path.join(root, ".kimi", "skills", "mimir")
    expect(existsSync(path.join(claudeSkillDir, "SKILL.md"))).toBe(true)
    expect(existsSync(path.join(kimiSkillDir, "SKILL.md"))).toBe(true)
    expect((await lstat(claudeSkillDir)).isSymbolicLink()).toBe(true)
    expect((await lstat(kimiSkillDir)).isSymbolicLink()).toBe(true)
    const canonicalSkillDir = await realpath(path.join(root, ".mimir", "skills", "mimir"))
    expect(await realpath(claudeSkillDir)).toBe(canonicalSkillDir)
    expect(await realpath(kimiSkillDir)).toBe(canonicalSkillDir)
    expect(existsSync(path.join(root, ".codex", "skills", "mimir", "SKILL.md"))).toBe(false)
    expect(result.written).toContain(path.join(".claude", "skills", "mimir"))
    expect(result.written).toContain(path.join(".kimi", "skills", "mimir-markdown-report"))
    expect(result.written).toContain(path.join(".kimi", "skills", "mimir-legal-dossier"))
  })

  it("can copy skills when symlinks are not wanted", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-agent-"))
    tempDirs.push(root)

    const result = await installAgentSkills({
      cwd: root,
      agents: ["cline"],
      scope: "project",
      mode: "copy",
    })

    const clineSkillDir = path.join(root, ".cline", "skills", "mimir")
    expect(result.installations[0]?.mode).toBe("copy")
    expect(existsSync(path.join(clineSkillDir, "SKILL.md"))).toBe(true)
    expect((await lstat(clineSkillDir)).isSymbolicLink()).toBe(false)
  })

  it("uses user-scope directories and environment overrides", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-agent-"))
    const home = await mkdtemp(path.join(os.tmpdir(), "mimir-home-"))
    tempDirs.push(root, home)

    const result = await installAgentSkills({
      cwd: root,
      agents: ["opencode"],
      scope: "user",
      mode: "copy",
      homeDir: home,
      env: { OPENCODE_SKILLS_DIR: "~/custom-opencode-skills" },
    })

    const targetDir = path.join(home, "custom-opencode-skills")
    expect(result.installations[0]?.targetDir).toBe(targetDir)
    expect(result.installations[0]?.mode).toBe("copy")
    expect(existsSync(path.join(targetDir, "mimir", "SKILL.md"))).toBe(true)
    expect(result.written).toContain(path.join(targetDir, "mimir"))
  })
})

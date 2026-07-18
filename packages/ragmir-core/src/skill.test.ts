import { existsSync } from "node:fs"
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
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
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-skill-"))
    tempDirs.push(root)

    const result = await installSkill({ cwd: root })
    const skill = await readFile(path.join(result.skillPath, "SKILL.md"), "utf8")
    const audioSkill = await readFile(path.join(result.audioSkillPath, "SKILL.md"), "utf8")
    const reportSkill = await readFile(path.join(result.reportSkillPath, "SKILL.md"), "utf8")
    const legalSkill = await readFile(path.join(result.legalSkillPath, "SKILL.md"), "utf8")
    const mcpConfig = JSON.parse(await readFile(result.mcpConfigPath, "utf8")) as {
      mcpServers: {
        ragmir: {
          command: string
          args: string[]
          cwd: string
          env: { RAGMIR_PROJECT_ROOT: string }
        }
      }
    }
    const claudeConfig = JSON.parse(await readFile(result.claudeConfigPath, "utf8")) as {
      type: string
      command: string
      args: string[]
      env: { RAGMIR_PROJECT_ROOT: string }
    }
    const kimiConfig = JSON.parse(await readFile(result.kimiConfigPath, "utf8")) as {
      mcpServers: { ragmir: { env: { RAGMIR_PROJECT_ROOT: string } } }
    }
    const opencodeConfig = JSON.parse(await readFile(result.opencodeConfigPath, "utf8")) as {
      mcp: {
        ragmir: {
          type: string
          command: string[]
          enabled: boolean
          environment: { RAGMIR_PROJECT_ROOT: string }
        }
      }
    }
    const clineConfig = JSON.parse(await readFile(result.clineConfigPath, "utf8")) as {
      mcpServers: { ragmir: { env: { RAGMIR_PROJECT_ROOT: string } } }
    }
    const codexConfig = await readFile(result.codexConfigPath, "utf8")
    const agentSetup = await readFile(result.agentSetupPath, "utf8")

    expect(skill).toContain("name: ragmir")
    expect(skill).toContain("rgr team compare")
    expect(skill).toContain("warn the user in the language they are using")
    expect(skill).toContain("rgr upgrade --check")
    expect(skill).toContain("never delete `.ragmir/storage/` as the first upgrade step")
    expect(audioSkill).toContain("name: ragmir-audio-summary")
    expect(reportSkill).toContain("name: ragmir-markdown-report")
    expect(legalSkill).toContain("name: ragmir-legal-dossier")
    expect(mcpConfig.mcpServers.ragmir.command).toBe("node")
    expect(mcpConfig.mcpServers.ragmir.args).toEqual([result.runnerPath, "serve-mcp"])
    expect(mcpConfig.mcpServers.ragmir.cwd).toBe(root)
    expect(mcpConfig.mcpServers.ragmir.env.RAGMIR_PROJECT_ROOT).toBe(root)
    expect(claudeConfig).toEqual({
      type: "stdio",
      command: "node",
      args: [result.runnerPath, "serve-mcp"],
      env: { RAGMIR_PROJECT_ROOT: root },
    })
    expect(codexConfig).toContain("[mcp_servers.ragmir]")
    expect(codexConfig).toContain('command = "node"')
    expect(codexConfig).toContain(`args = [${JSON.stringify(result.runnerPath)}, "serve-mcp"]`)
    expect(codexConfig).toContain(`cwd = ${JSON.stringify(root)}`)
    expect(codexConfig).toContain("[[skills.config]]")
    expect(codexConfig).toContain(path.join(root, ".ragmir", "skills", "ragmir"))
    expect(codexConfig).toContain(path.join(root, ".ragmir", "skills", "ragmir-legal-dossier"))
    expect(kimiConfig.mcpServers.ragmir.env.RAGMIR_PROJECT_ROOT).toBe(root)
    expect(opencodeConfig.mcp.ragmir).toEqual({
      type: "local",
      command: ["node", result.runnerPath, "serve-mcp"],
      enabled: true,
      environment: { RAGMIR_PROJECT_ROOT: root },
    })
    expect(clineConfig.mcpServers.ragmir.env.RAGMIR_PROJECT_ROOT).toBe(root)
    expect(agentSetup).toContain("Claude Code")
    expect(agentSetup).toContain("ragmir_route_prompt")
    expect(agentSetup).toContain("Kimi Code CLI")
    expect(agentSetup).toContain("OpenCode")
    expect(agentSetup).toContain("Cline")
    expect(agentSetup).toContain(".agents/skills/")
    const runner = await readFile(result.runnerPath, "utf8")
    expect(runner).toContain("@jcode.labs/ragmir@")
    expect(runner).toContain("dist/cli-entry.js")
    expect(runner).toContain("await import(pathToFileURL(cliPath).href)")
  })

  it("should generate unique rooted MCP helpers for a nested monorepo base", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-skill-monorepo-"))
    tempDirs.push(root)
    const app = path.join(root, "apps", "web")
    await writeRagmirConfig(root)
    await writeRagmirConfig(app)

    const result = await installSkill({ cwd: app, agents: ["claude", "codex"] })
    const mcpConfig = JSON.parse(await readFile(result.mcpConfigPath, "utf8")) as {
      mcpServers: Record<string, { cwd: string; env: { RAGMIR_PROJECT_ROOT: string } }>
    }
    const claudeConfig = JSON.parse(await readFile(result.claudeConfigPath, "utf8")) as {
      env: { RAGMIR_PROJECT_ROOT: string }
    }
    const codexConfig = await readFile(result.codexConfigPath, "utf8")

    expect(result.mcpServerName).toBe("ragmir-apps-web")
    expect(mcpConfig.mcpServers["ragmir-apps-web"]).toEqual(
      expect.objectContaining({
        cwd: app,
        env: { RAGMIR_PROJECT_ROOT: app },
      }),
    )
    expect(claudeConfig.env.RAGMIR_PROJECT_ROOT).toBe(app)
    expect(codexConfig).toContain("[mcp_servers.ragmir-apps-web]")
    expect(codexConfig).toContain(`cwd = ${JSON.stringify(app)}`)
  })

  it("adds Ragmir runtime folders to gitignore without duplicating entries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-skill-"))
    tempDirs.push(root)

    const first = await installSkill({ cwd: root })
    const second = await installSkill({ cwd: root })
    const gitignore = await readFile(path.join(root, ".gitignore"), "utf8")

    expect(first.written).toContain(".gitignore")
    expect(second.written).not.toContain(".gitignore")
    expect(first.written).toContain(path.join(".ragmir", "skills", "ragmir-audio-summary"))
    expect(first.written).toContain(path.join(".ragmir", "skills", "ragmir-markdown-report"))
    expect(first.written).toContain(path.join(".ragmir", "skills", "ragmir-legal-dossier"))
    expect(first.written).toContain(path.join(".ragmir", "run.cjs"))
    expect(first.written).toContain(path.join(".ragmir", "claude-mcp-server.json"))
    expect(first.written).toContain(path.join(".ragmir", "codex-mcp.toml"))
    expect(first.written).toContain(path.join(".ragmir", "kimi-mcp.json"))
    expect(first.written).toContain(path.join(".ragmir", "opencode.jsonc"))
    expect(first.written).toContain(path.join(".ragmir", "cline-mcp.json"))
    expect(first.written).toContain(path.join(".ragmir", "agent-setup.md"))
    expect(gitignore.match(/^\.ragmir\/$/gm)).toHaveLength(1)
    expect(gitignore).not.toContain(".kb/")
    expect(gitignore).not.toContain("private/**")
    expect(gitignore).not.toContain("!private/")
  })

  it("uses the generated local runner independently of the target package manager", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-skill-"))
    tempDirs.push(root)
    await writeFile(path.join(root, "package-lock.json"), "{}\n", "utf8")

    const result = await installSkill({ cwd: root })
    const mcpConfig = JSON.parse(await readFile(result.mcpConfigPath, "utf8")) as {
      mcpServers: { ragmir: { command: string; args: string[] } }
    }
    const codexConfig = await readFile(result.codexConfigPath, "utf8")
    const readme = await readFile(result.readmePath, "utf8")

    expect(mcpConfig.mcpServers.ragmir.command).toBe("node")
    expect(mcpConfig.mcpServers.ragmir.args).toEqual([result.runnerPath, "serve-mcp"])
    expect(codexConfig).toContain('command = "node"')
    expect(codexConfig).toContain(`args = [${JSON.stringify(result.runnerPath)}, "serve-mcp"]`)
    expect(readme).toContain("node .ragmir/run.cjs serve-mcp")
  })

  it("can generate selected agent helpers with a custom MCP command", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-skill-"))
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
      env: { RAGMIR_PROJECT_ROOT: string }
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
      env: { RAGMIR_PROJECT_ROOT: root },
    })
    expect(codexConfig).toContain("[mcp_servers.project-docs]")
    expect(codexConfig).toContain('command = "./scripts/serve-mcp.sh"')
    expect(codexConfig).toContain('args = ["--stdio"]')
    expect(result.agentHelpers.map((helper) => helper.agent)).toEqual(["claude", "codex"])
    expect(result.written).toContain(path.join(".ragmir", "claude-mcp-server.json"))
    expect(result.written).toContain(path.join(".ragmir", "codex-mcp.toml"))
    expect(result.written).not.toContain(path.join(".ragmir", "kimi-mcp.json"))
    expect(result.written).not.toContain(path.join(".ragmir", "opencode.jsonc"))
    expect(result.written).not.toContain(path.join(".ragmir", "cline-mcp.json"))
    expect(existsSync(path.join(root, ".ragmir", "kimi-mcp.json"))).toBe(false)
    expect(existsSync(path.join(root, ".ragmir", "opencode.jsonc"))).toBe(false)
    expect(existsSync(path.join(root, ".ragmir", "cline-mcp.json"))).toBe(false)
    expect(readme).toContain("project-docs")
    expect(readme).toContain("./scripts/serve-mcp.sh --stdio")
    expect(readme).not.toContain("kimi --mcp-config-file")
  })
})

async function writeRagmirConfig(projectRoot: string): Promise<void> {
  await mkdir(path.join(projectRoot, ".ragmir"), { recursive: true })
  await writeFile(path.join(projectRoot, ".ragmir", "config.json"), "{}\n", "utf8")
}

describe("installAgentSkills", () => {
  it("links selected skills into native project-scope agent folders by default", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-agent-"))
    tempDirs.push(root)

    const result = await installAgentSkills({
      cwd: root,
      agents: parseAgentTargets("claude,codex,kimi"),
      scope: "project",
    })

    expect(result.installations.map((installation) => installation.agent)).toEqual([
      "claude",
      "codex",
      "kimi",
    ])
    expect(result.installations.map((installation) => installation.mode)).toEqual([
      "link",
      "link",
      "link",
    ])
    const claudeSkillDir = path.join(root, ".claude", "skills", "ragmir")
    const codexSkillDir = path.join(root, ".agents", "skills", "ragmir")
    const kimiSkillDir = path.join(root, ".kimi", "skills", "ragmir")
    expect(existsSync(path.join(claudeSkillDir, "SKILL.md"))).toBe(true)
    expect(existsSync(path.join(codexSkillDir, "SKILL.md"))).toBe(true)
    expect(existsSync(path.join(kimiSkillDir, "SKILL.md"))).toBe(true)
    expect((await lstat(claudeSkillDir)).isSymbolicLink()).toBe(true)
    expect((await lstat(codexSkillDir)).isSymbolicLink()).toBe(true)
    expect((await lstat(kimiSkillDir)).isSymbolicLink()).toBe(true)
    const canonicalSkillDir = await realpath(path.join(root, ".ragmir", "skills", "ragmir"))
    expect(await realpath(claudeSkillDir)).toBe(canonicalSkillDir)
    expect(await realpath(codexSkillDir)).toBe(canonicalSkillDir)
    expect(await realpath(kimiSkillDir)).toBe(canonicalSkillDir)
    expect(existsSync(path.join(root, ".codex", "skills", "ragmir", "SKILL.md"))).toBe(false)
    expect(result.written).toContain(path.join(".claude", "skills", "ragmir"))
    expect(result.written).toContain(path.join(".kimi", "skills", "ragmir-markdown-report"))
    expect(result.written).toContain(path.join(".kimi", "skills", "ragmir-legal-dossier"))
    const gitignore = await readFile(path.join(root, ".gitignore"), "utf8")
    expect(gitignore).toContain(".agents/skills/ragmir")
    expect(gitignore).toContain(".claude/skills/ragmir")
  })

  it("can copy skills when symlinks are not wanted", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-agent-"))
    tempDirs.push(root)

    const result = await installAgentSkills({
      cwd: root,
      agents: ["cline"],
      scope: "project",
      mode: "copy",
    })

    const clineSkillDir = path.join(root, ".cline", "skills", "ragmir")
    expect(result.installations[0]?.mode).toBe("copy")
    expect(existsSync(path.join(clineSkillDir, "SKILL.md"))).toBe(true)
    expect((await lstat(clineSkillDir)).isSymbolicLink()).toBe(false)
    expect(existsSync(path.join(clineSkillDir, ".ragmir-managed.json"))).toBe(true)
  })

  it("refuses to replace unmanaged skills unless force is explicit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-agent-"))
    tempDirs.push(root)
    const customSkillDir = path.join(root, ".claude", "skills", "ragmir")
    await mkdir(customSkillDir, { recursive: true })
    await writeFile(path.join(customSkillDir, "SKILL.md"), "custom skill\n", "utf8")

    await expect(
      installAgentSkills({ cwd: root, agents: ["claude"], scope: "project" }),
    ).rejects.toThrow("Refusing to replace unmanaged agent skill")
    expect(await readFile(path.join(customSkillDir, "SKILL.md"), "utf8")).toBe("custom skill\n")

    await installAgentSkills({ cwd: root, agents: ["claude"], scope: "project", force: true })
    expect((await lstat(customSkillDir)).isSymbolicLink()).toBe(true)
  })

  it("uses user-scope directories and environment overrides", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-agent-"))
    const home = await mkdtemp(path.join(os.tmpdir(), "ragmir-home-"))
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
    expect(existsSync(path.join(targetDir, "ragmir", "SKILL.md"))).toBe(true)
    expect(result.written).toContain(path.join(targetDir, "ragmir"))
  })
})

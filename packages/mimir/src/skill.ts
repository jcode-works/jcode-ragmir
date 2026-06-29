import { cp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { DEFAULT_SKILL_TARGET_DIR, MIMIR_DIR } from "./defaults.js"
import { ensureMimirGitignore } from "./gitignore.js"
import { kbCommand } from "./package-manager.js"

export type AgentTarget = "claude" | "codex" | "kimi" | "opencode" | "cline"
export type AgentInstallScope = "project" | "user"
export type AgentInstallMode = "link" | "copy"

export interface InstallSkillOptions {
  cwd?: string
  targetDir?: string
}

export interface InstallSkillResult {
  skillPath: string
  audioSkillPath: string
  reportSkillPath: string
  mcpConfigPath: string
  claudeConfigPath: string
  codexConfigPath: string
  kimiConfigPath: string
  opencodeConfigPath: string
  clineConfigPath: string
  agentSetupPath: string
  readmePath: string
  written: string[]
}

export interface InstallAgentSkillsOptions {
  cwd?: string
  agents?: readonly AgentTarget[]
  scope?: AgentInstallScope
  mode?: AgentInstallMode
  homeDir?: string
  env?: Record<string, string | undefined>
}

export interface AgentSkillInstallation {
  agent: AgentTarget
  label: string
  scope: AgentInstallScope
  mode: AgentInstallMode
  targetDir: string
  skillPaths: string[]
}

export interface InstallAgentSkillsResult {
  projectKit: InstallSkillResult
  installations: AgentSkillInstallation[]
  written: string[]
}

const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PRIMARY_SKILL_NAME = "mimir"
const AUDIO_SKILL_NAME = "mimir-audio-summary"
const REPORT_SKILL_NAME = "mimir-markdown-report"
const SKILL_NAMES = [PRIMARY_SKILL_NAME, AUDIO_SKILL_NAME, REPORT_SKILL_NAME] as const

export const SUPPORTED_AGENT_TARGETS: readonly AgentTarget[] = [
  "claude",
  "codex",
  "kimi",
  "opencode",
  "cline",
] as const

const AGENT_TARGET_ALIASES = new Map<string, AgentTarget>([
  ["claude", "claude"],
  ["claude-code", "claude"],
  ["codex", "codex"],
  ["kimi", "kimi"],
  ["kimi-code", "kimi"],
  ["opencode", "opencode"],
  ["open-code", "opencode"],
  ["cline", "cline"],
])

const AGENT_DESTINATIONS: Record<
  AgentTarget,
  {
    label: string
    env: string
    projectDir: string
    userDir: (homeDir: string) => string
  }
> = {
  claude: {
    label: "Claude Code",
    env: "CLAUDE_SKILLS_DIR",
    projectDir: path.join(".claude", "skills"),
    userDir: (homeDir) => path.join(homeDir, ".claude", "skills"),
  },
  codex: {
    label: "Codex",
    env: "CODEX_SKILLS_DIR",
    projectDir: path.join(".codex", "skills"),
    userDir: (homeDir) => path.join(homeDir, ".codex", "skills"),
  },
  kimi: {
    label: "Kimi Code CLI",
    env: "KIMI_SKILLS_DIR",
    projectDir: path.join(".kimi", "skills"),
    userDir: (homeDir) => path.join(homeDir, ".kimi", "skills"),
  },
  opencode: {
    label: "OpenCode",
    env: "OPENCODE_SKILLS_DIR",
    projectDir: path.join(".opencode", "skills"),
    userDir: (homeDir) => path.join(homeDir, ".config", "opencode", "skills"),
  },
  cline: {
    label: "Cline",
    env: "CLINE_SKILLS_DIR",
    projectDir: path.join(".cline", "skills"),
    userDir: (homeDir) => path.join(homeDir, ".cline", "skills"),
  },
}

export function bundledSkillPath(skillName = PRIMARY_SKILL_NAME): string {
  return path.join(PACKAGE_ROOT, "skills", skillName)
}

export function parseAgentTargets(value: string | readonly string[] | undefined): AgentTarget[] {
  if (value === undefined || value === "" || value === "all") {
    return [...SUPPORTED_AGENT_TARGETS]
  }

  const entries = typeof value === "string" ? value.split(",") : value
  const targets = new Set<AgentTarget>()

  for (const entry of entries) {
    const normalized = entry.trim().toLowerCase()
    if (normalized === "" || normalized === "all") {
      for (const target of SUPPORTED_AGENT_TARGETS) {
        targets.add(target)
      }
      continue
    }
    const target = AGENT_TARGET_ALIASES.get(normalized)
    if (!target) {
      throw new Error(
        `Unknown agent target "${entry}". Expected one of: all, ${SUPPORTED_AGENT_TARGETS.join(", ")}.`,
      )
    }
    targets.add(target)
  }

  return [...targets]
}

export async function installSkill(options: InstallSkillOptions = {}): Promise<InstallSkillResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const targetDir = path.resolve(cwd, options.targetDir ?? DEFAULT_SKILL_TARGET_DIR)
  const skillPath = path.join(targetDir, PRIMARY_SKILL_NAME)
  const audioSkillPath = path.join(targetDir, AUDIO_SKILL_NAME)
  const reportSkillPath = path.join(targetDir, REPORT_SKILL_NAME)
  const mimirDir = path.resolve(cwd, MIMIR_DIR)
  const mcpConfigPath = path.join(mimirDir, "mcp.json")
  const claudeConfigPath = path.join(mimirDir, "claude-mcp-server.json")
  const codexConfigPath = path.join(mimirDir, "codex-mcp.toml")
  const kimiConfigPath = path.join(mimirDir, "kimi-mcp.json")
  const opencodeConfigPath = path.join(mimirDir, "opencode.jsonc")
  const clineConfigPath = path.join(mimirDir, "cline-mcp.json")
  const agentSetupPath = path.join(mimirDir, "agent-setup.md")
  const readmePath = path.join(mimirDir, "README.md")

  await mkdir(targetDir, { recursive: true })
  await mkdir(mimirDir, { recursive: true })
  await copyBundledSkills(targetDir)

  const serveCommand = await kbCommand(cwd, ["serve-mcp"])
  const doctorCommand = await kbCommand(cwd, ["doctor"])
  const installAgentCommand = await kbCommand(cwd, ["install-agent", "--agents", "claude,kimi"])
  await writeFile(
    mcpConfigPath,
    `${JSON.stringify(mcpConfig(cwd, serveCommand), null, 2)}\n`,
    "utf8",
  )
  await writeFile(
    claudeConfigPath,
    `${JSON.stringify(claudeMcpServer(serveCommand), null, 2)}\n`,
    "utf8",
  )
  await writeFile(codexConfigPath, codexMcpConfig(cwd, serveCommand), "utf8")
  await writeFile(
    kimiConfigPath,
    `${JSON.stringify(mcpConfig(cwd, serveCommand, { MIMIR_PROJECT_ROOT: cwd }), null, 2)}\n`,
    "utf8",
  )
  await writeFile(opencodeConfigPath, opencodeConfig(cwd, serveCommand), "utf8")
  await writeFile(
    clineConfigPath,
    `${JSON.stringify(mcpConfig(cwd, serveCommand, { MIMIR_PROJECT_ROOT: cwd }), null, 2)}\n`,
    "utf8",
  )
  await writeFile(
    agentSetupPath,
    agentSetupGuide({
      skillPath,
      audioSkillPath,
      reportSkillPath,
      mcpConfigPath,
      claudeConfigPath,
      codexConfigPath,
      kimiConfigPath,
      opencodeConfigPath,
      clineConfigPath,
      installAgentCommand: installAgentCommand.display,
      serveCommand: serveCommand.display,
      doctorCommand: doctorCommand.display,
    }),
    "utf8",
  )
  await writeFile(
    readmePath,
    agentKitReadme({
      skillPath,
      audioSkillPath,
      reportSkillPath,
      mcpConfigPath,
      claudeConfigPath,
      codexConfigPath,
      kimiConfigPath,
      opencodeConfigPath,
      clineConfigPath,
      agentSetupPath,
      installAgentCommand: installAgentCommand.display,
      serveCommand: serveCommand.display,
      doctorCommand: doctorCommand.display,
    }),
    "utf8",
  )
  const wroteGitignore = await ensureMimirGitignore(cwd)

  const written = [
    path.relative(cwd, skillPath),
    path.relative(cwd, audioSkillPath),
    path.relative(cwd, reportSkillPath),
    path.relative(cwd, mcpConfigPath),
    path.relative(cwd, claudeConfigPath),
    path.relative(cwd, codexConfigPath),
    path.relative(cwd, kimiConfigPath),
    path.relative(cwd, opencodeConfigPath),
    path.relative(cwd, clineConfigPath),
    path.relative(cwd, agentSetupPath),
    path.relative(cwd, readmePath),
  ]

  if (wroteGitignore) {
    written.push(".gitignore")
  }

  return {
    skillPath,
    audioSkillPath,
    reportSkillPath,
    mcpConfigPath,
    claudeConfigPath,
    codexConfigPath,
    kimiConfigPath,
    opencodeConfigPath,
    clineConfigPath,
    agentSetupPath,
    readmePath,
    written,
  }
}

export async function installAgentSkills(
  options: InstallAgentSkillsOptions = {},
): Promise<InstallAgentSkillsResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const scope = options.scope ?? "project"
  const requestedMode = options.mode ?? "link"
  const homeDir = path.resolve(options.homeDir ?? process.env.HOME ?? process.cwd())
  const env = options.env ?? process.env
  const agents = options.agents ?? SUPPORTED_AGENT_TARGETS
  const projectKit = await installSkill({ cwd })
  const sourceDir = path.dirname(projectKit.skillPath)
  const installations: AgentSkillInstallation[] = []
  const written: string[] = []

  for (const agent of agents) {
    const destination = AGENT_DESTINATIONS[agent]
    const targetDir = agentTargetDir(agent, scope, cwd, homeDir, env)
    await mkdir(targetDir, { recursive: true })

    const { mode, skillPaths } = await exposeAgentSkills(sourceDir, targetDir, requestedMode)
    written.push(...skillPaths.map((skillPath) => displayPath(cwd, skillPath)))

    installations.push({
      agent,
      label: destination.label,
      scope,
      mode,
      targetDir,
      skillPaths,
    })
  }

  return {
    projectKit,
    installations,
    written,
  }
}

async function copyBundledSkills(targetDir: string): Promise<void> {
  await Promise.all(
    SKILL_NAMES.map((skillName) =>
      cp(bundledSkillPath(skillName), path.join(targetDir, skillName), {
        recursive: true,
        force: true,
      }),
    ),
  )
}

async function exposeAgentSkills(
  sourceDir: string,
  targetDir: string,
  requestedMode: AgentInstallMode,
): Promise<{ mode: AgentInstallMode; skillPaths: string[] }> {
  if (requestedMode === "copy") {
    return copyAgentSkills(sourceDir, targetDir)
  }

  try {
    return await linkAgentSkills(sourceDir, targetDir)
  } catch {
    return copyAgentSkills(sourceDir, targetDir)
  }
}

async function linkAgentSkills(
  sourceDir: string,
  targetDir: string,
): Promise<{ mode: AgentInstallMode; skillPaths: string[] }> {
  const skillPaths: string[] = []
  for (const skillName of SKILL_NAMES) {
    const source = path.join(sourceDir, skillName)
    const target = path.join(targetDir, skillName)
    await replaceWithDirectorySymlink(source, target)
    skillPaths.push(target)
  }
  return { mode: "link", skillPaths }
}

async function copyAgentSkills(
  sourceDir: string,
  targetDir: string,
): Promise<{ mode: AgentInstallMode; skillPaths: string[] }> {
  const skillPaths: string[] = []
  for (const skillName of SKILL_NAMES) {
    const source = path.join(sourceDir, skillName)
    const target = path.join(targetDir, skillName)
    await rm(target, { recursive: true, force: true })
    await cp(source, target, { recursive: true, force: true })
    skillPaths.push(target)
  }
  return { mode: "copy", skillPaths }
}

async function replaceWithDirectorySymlink(source: string, target: string): Promise<void> {
  if (path.resolve(source) === path.resolve(target)) {
    return
  }
  await rm(target, { recursive: true, force: true })
  await symlink(source, target, process.platform === "win32" ? "junction" : "dir")
}

function agentTargetDir(
  agent: AgentTarget,
  scope: AgentInstallScope,
  cwd: string,
  homeDir: string,
  env: Record<string, string | undefined>,
): string {
  const destination = AGENT_DESTINATIONS[agent]
  const override = env[destination.env]
  if (override) {
    return path.resolve(expandHome(override, homeDir))
  }
  if (scope === "project") {
    return path.resolve(cwd, destination.projectDir)
  }
  return destination.userDir(homeDir)
}

function expandHome(input: string, homeDir: string): string {
  if (input === "~") {
    return homeDir
  }
  if (input.startsWith("~/")) {
    return path.join(homeDir, input.slice(2))
  }
  return input
}

function displayPath(cwd: string, filePath: string): string {
  const relative = path.relative(cwd, filePath)
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative
  }
  return filePath
}

function mcpConfig(
  cwd: string,
  serveCommand: Awaited<ReturnType<typeof kbCommand>>,
  env?: Record<string, string>,
): unknown {
  const config: {
    mcpServers: {
      mimir: {
        command: string
        args: string[]
        cwd: string
        env?: Record<string, string>
      }
    }
  } = {
    mcpServers: {
      mimir: {
        command: serveCommand.command,
        args: serveCommand.args,
        cwd,
      },
    },
  }
  if (env) {
    config.mcpServers.mimir.env = env
  }
  return config
}

function claudeMcpServer(serveCommand: Awaited<ReturnType<typeof kbCommand>>): unknown {
  return {
    type: "stdio",
    command: serveCommand.command,
    args: serveCommand.args,
  }
}

function codexMcpConfig(cwd: string, serveCommand: Awaited<ReturnType<typeof kbCommand>>): string {
  return `[mcp_servers.mimir]
command = ${tomlString(serveCommand.command)}
args = ${tomlArray(serveCommand.args)}
cwd = ${tomlString(cwd)}

[[skills.config]]
path = ${tomlString(path.join(cwd, DEFAULT_SKILL_TARGET_DIR, PRIMARY_SKILL_NAME))}
enabled = true

[[skills.config]]
path = ${tomlString(path.join(cwd, DEFAULT_SKILL_TARGET_DIR, AUDIO_SKILL_NAME))}
enabled = true

[[skills.config]]
path = ${tomlString(path.join(cwd, DEFAULT_SKILL_TARGET_DIR, REPORT_SKILL_NAME))}
enabled = true

`
}

function opencodeConfig(cwd: string, serveCommand: Awaited<ReturnType<typeof kbCommand>>): string {
  const config = {
    $schema: "https://opencode.ai/config.json",
    mcp: {
      mimir: {
        type: "local",
        command: [serveCommand.command, ...serveCommand.args],
        enabled: true,
        environment: {
          MIMIR_PROJECT_ROOT: cwd,
        },
      },
    },
  }
  return `${JSON.stringify(config, null, 2)}\n`
}

function tomlArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

interface AgentKitReadmeInput {
  skillPath: string
  audioSkillPath: string
  reportSkillPath: string
  mcpConfigPath: string
  claudeConfigPath: string
  codexConfigPath: string
  kimiConfigPath: string
  opencodeConfigPath: string
  clineConfigPath: string
  agentSetupPath: string
  installAgentCommand: string
  serveCommand: string
  doctorCommand: string
}

function agentKitReadme(input: AgentKitReadmeInput): string {
  return `# Mimir Agent Kit

This folder contains portable agent instructions for Mimir.

## Skill

Skill folder:

\`\`\`plain text
${input.skillPath}
\`\`\`

Agents that support skill folders can load that folder directly.

Optional audio-summary skill folder:

\`\`\`plain text
${input.audioSkillPath}
\`\`\`

Use it only when the user asks for a listenable summary. It renders generated audio under ignored
local Mimir state by default. Use Transformers.js WAV for confidential content and Edge MP3 only
when online TTS is explicitly acceptable.

Optional Markdown-report skill folder:

\`\`\`plain text
${input.reportSkillPath}
\`\`\`

Use it when the user asks for a cited Markdown report, dossier, audit memo, or planning note. It
writes reports under ignored local Mimir state by default.

## MCP

MCP config example:

\`\`\`plain text
${input.mcpConfigPath}
\`\`\`

Use the MCP server when your agent supports MCP tools. The server command is:

\`\`\`bash
${input.serveCommand}
\`\`\`

## Native Agent Setup

For automatic skill discovery in one or more supported agents, run:

\`\`\`bash
${input.installAgentCommand}
\`\`\`

Use \`--agents claude\`, \`--agents kimi\`, or a comma-separated list when the user only uses one
agent. Use \`--scope user\` for global installs and \`--scope project\` for repository-local agent
folders. By default, native agent folders link back to \`.mimir/skills/\` so there is one source of
truth. Use \`--mode copy\` only when an agent or filesystem cannot follow symlinks.

Detailed setup notes:

\`\`\`plain text
${input.agentSetupPath}
\`\`\`

Claude Code local MCP setup:

\`\`\`bash
claude mcp add-json --scope local mimir "$(cat ${MIMIR_DIR}/claude-mcp-server.json)"
\`\`\`

Run that command from this repository root. Mimir also reads \`CLAUDE_PROJECT_DIR\`, so the server
uses the active Claude Code project as the knowledge-base root.

For other MCP clients that cannot set a working directory, launch the server with
\`MIMIR_PROJECT_ROOT=/absolute/path/to/repository\`.

Codex setup:

\`\`\`plain text
${input.codexConfigPath}
\`\`\`

Copy that TOML snippet into \`~/.codex/config.toml\` or another trusted Codex config layer.

Kimi setup:

\`\`\`bash
kimi --mcp-config-file ${input.kimiConfigPath}
\`\`\`

OpenCode setup:

\`\`\`plain text
${input.opencodeConfigPath}
\`\`\`

Cline setup:

\`\`\`plain text
${input.clineConfigPath}
\`\`\`

Before relying on retrieved context, run:

\`\`\`bash
${input.doctorCommand}
\`\`\`

`
}

interface AgentSetupGuideInput {
  skillPath: string
  audioSkillPath: string
  reportSkillPath: string
  mcpConfigPath: string
  claudeConfigPath: string
  codexConfigPath: string
  kimiConfigPath: string
  opencodeConfigPath: string
  clineConfigPath: string
  installAgentCommand: string
  serveCommand: string
  doctorCommand: string
}

function agentSetupGuide(input: AgentSetupGuideInput): string {
  return `# Mimir Agent Setup

Mimir keeps the repository-local source of truth under \`.mimir/skills/\`. Native agent folders link
to that source by default, so there is one original version to update. Install only the agents you
use.

## Install Native Skills

\`\`\`bash
${input.installAgentCommand}
\`\`\`

Examples:

\`\`\`bash
${input.installAgentCommand.replace("claude,kimi", "claude")}
${input.installAgentCommand.replace("claude,kimi", "kimi")}
${input.installAgentCommand.replace("claude,kimi", "claude,codex,kimi,opencode,cline")}
${input.installAgentCommand.replace("claude,kimi", "cline")} --mode copy
\`\`\`

Default project-scope targets:

| Agent | Project skill directory | User skill directory |
| --- | --- | --- |
| Claude Code | \`.claude/skills/\` | \`~/.claude/skills/\` |
| Codex | \`.codex/skills/\` | \`~/.codex/skills/\` |
| Kimi Code CLI | \`.kimi/skills/\` | \`~/.kimi/skills/\` |
| OpenCode | \`.opencode/skills/\` | \`~/.config/opencode/skills/\` |
| Cline | \`.cline/skills/\` | \`~/.cline/skills/\` |

Override paths with \`CLAUDE_SKILLS_DIR\`, \`CODEX_SKILLS_DIR\`, \`KIMI_SKILLS_DIR\`,
\`OPENCODE_SKILLS_DIR\`, or \`CLINE_SKILLS_DIR\`.

Use \`--mode copy\` only when an agent runtime does not follow symlinked skill directories. When using
copy mode, rerun \`install-agent\` after refreshing \`.mimir/skills/\`.

## Skill Folders

\`\`\`plain text
${input.skillPath}
${input.audioSkillPath}
${input.reportSkillPath}
\`\`\`

## MCP Helpers

Generic MCP:

\`\`\`plain text
${input.mcpConfigPath}
\`\`\`

Claude Code:

\`\`\`bash
claude mcp add-json --scope local mimir "$(cat ${MIMIR_DIR}/claude-mcp-server.json)"
\`\`\`

Codex:

\`\`\`plain text
${input.codexConfigPath}
\`\`\`

Kimi Code CLI:

\`\`\`bash
kimi --mcp-config-file ${input.kimiConfigPath}
\`\`\`

OpenCode:

\`\`\`plain text
${input.opencodeConfigPath}
\`\`\`

Cline:

\`\`\`plain text
${input.clineConfigPath}
\`\`\`

The MCP server command is:

\`\`\`bash
${input.serveCommand}
\`\`\`

Before relying on retrieved context, run:

\`\`\`bash
${input.doctorCommand}
\`\`\`

`
}

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { cp, lstat, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { DEFAULT_SKILL_TARGET_DIR, RAGMIR_DIR, RAGMIR_PROJECT_ROOT_ENV } from "./defaults.js"
import { ensureRagmirGitignore } from "./gitignore.js"
import { knowledgeBaseIdentity } from "./knowledge-bases.js"
import {
  type RagmirCommand,
  RGR_RUNNER_FILENAME,
  RGR_RUNNER_PROBE_ARG,
  rgrCommand,
} from "./package-manager.js"
import type { AgentIntegrationReport, AgentTarget, RagmirRunnerMode } from "./types.js"
import { VERSION } from "./version.js"

export type { AgentIntegrationReport, AgentTarget, RagmirRunnerMode } from "./types.js"
export type AgentInstallScope = "project" | "user"
export type AgentInstallMode = "link" | "copy"

export interface InstallSkillOptions {
  cwd?: string
  targetDir?: string
  agents?: readonly AgentTarget[]
  mcpServerName?: string
  mcpCommand?: string
  mcpArgs?: readonly string[]
}

export interface InstallSkillResult {
  skillPath: string
  audioSkillPath: string
  reportSkillPath: string
  legalSkillPath: string
  mcpConfigPath: string
  claudeConfigPath: string
  codexConfigPath: string
  kimiConfigPath: string
  opencodeConfigPath: string
  clineConfigPath: string
  agentSetupPath: string
  readmePath: string
  runnerPath: string
  agentHelpers: AgentHelperFile[]
  mcpServerName: string
  mcpCommand: string
  mcpArgs: string[]
  written: string[]
}

export interface InstallAgentSkillsOptions extends InstallSkillOptions {
  scope?: AgentInstallScope
  mode?: AgentInstallMode
  homeDir?: string
  env?: Record<string, string | undefined>
  force?: boolean
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

export interface AgentHelperFile {
  agent: AgentTarget
  label: string
  path: string
}

const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PRIMARY_SKILL_NAME = "ragmir"
const AUDIO_SKILL_NAME = "ragmir-audio-summary"
const REPORT_SKILL_NAME = "ragmir-markdown-report"
const LEGAL_SKILL_NAME = "ragmir-legal-dossier"
const DEFAULT_MCP_SERVER_NAME = "ragmir"
const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]+$/u
const MANAGED_SKILL_METADATA_FILENAME = ".ragmir-managed.json"
export const SKILL_NAMES = [
  PRIMARY_SKILL_NAME,
  AUDIO_SKILL_NAME,
  REPORT_SKILL_NAME,
  LEGAL_SKILL_NAME,
] as const

export const MCP_CONFIG_FILENAME = "mcp.json"
export const AGENT_SETUP_FILENAME = "agent-setup.md"

export const SUPPORTED_AGENT_TARGETS: readonly AgentTarget[] = [
  "claude",
  "codex",
  "kimi",
  "opencode",
  "cline",
] as const

export const AGENT_HELPER_CONFIG_FILENAMES: Record<AgentTarget, string> = {
  claude: "claude-mcp-server.json",
  codex: "codex-mcp.toml",
  kimi: "kimi-mcp.json",
  opencode: "opencode.jsonc",
  cline: "cline-mcp.json",
}

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
    projectDir: path.join(".agents", "skills"),
    userDir: (homeDir) => path.join(homeDir, ".agents", "skills"),
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

  const entries =
    typeof value === "string" ? value.split(",") : value.flatMap((entry) => entry.split(","))
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
  const agents = options.agents ? parseAgentTargets(options.agents) : [...SUPPORTED_AGENT_TARGETS]
  const agentSet = new Set<AgentTarget>(agents)
  const mcpServerName = normalizeMcpServerName(options.mcpServerName ?? suggestedMcpServerName(cwd))
  const skillPath = path.join(targetDir, PRIMARY_SKILL_NAME)
  const audioSkillPath = path.join(targetDir, AUDIO_SKILL_NAME)
  const reportSkillPath = path.join(targetDir, REPORT_SKILL_NAME)
  const legalSkillPath = path.join(targetDir, LEGAL_SKILL_NAME)
  const ragmirDir = path.resolve(cwd, RAGMIR_DIR)
  const mcpConfigPath = path.join(ragmirDir, MCP_CONFIG_FILENAME)
  const agentConfigPaths: Record<AgentTarget, string> = {
    claude: path.join(ragmirDir, AGENT_HELPER_CONFIG_FILENAMES.claude),
    codex: path.join(ragmirDir, AGENT_HELPER_CONFIG_FILENAMES.codex),
    kimi: path.join(ragmirDir, AGENT_HELPER_CONFIG_FILENAMES.kimi),
    opencode: path.join(ragmirDir, AGENT_HELPER_CONFIG_FILENAMES.opencode),
    cline: path.join(ragmirDir, AGENT_HELPER_CONFIG_FILENAMES.cline),
  }
  const claudeConfigPath = agentConfigPaths.claude
  const codexConfigPath = agentConfigPaths.codex
  const kimiConfigPath = agentConfigPaths.kimi
  const opencodeConfigPath = agentConfigPaths.opencode
  const clineConfigPath = agentConfigPaths.cline
  const agentSetupPath = path.join(ragmirDir, AGENT_SETUP_FILENAME)
  const readmePath = path.join(ragmirDir, "README.md")
  const runnerPath = path.join(ragmirDir, RGR_RUNNER_FILENAME)

  await mkdir(targetDir, { recursive: true })
  await mkdir(ragmirDir, { recursive: true })
  await copyBundledSkills(targetDir)
  await writeFile(
    runnerPath,
    ragmirRunnerSource(VERSION, path.join(PACKAGE_ROOT, "dist", "cli-entry.js")),
    { encoding: "utf8", mode: 0o755 },
  )

  const serveCommand = await resolveMcpCommand(cwd, options)
  const doctorCommand = await rgrCommand(cwd, ["doctor"])
  const installAgentCommand = await rgrCommand(cwd, ["install-agent", "--agents", agents.join(",")])
  await writeFile(
    mcpConfigPath,
    `${JSON.stringify(
      mcpConfig(cwd, serveCommand, { [RAGMIR_PROJECT_ROOT_ENV]: cwd }, mcpServerName),
      null,
      2,
    )}\n`,
    "utf8",
  )

  const agentHelpers: AgentHelperFile[] = []
  for (const agent of SUPPORTED_AGENT_TARGETS) {
    const helperPath = agentConfigPaths[agent]
    if (!agentSet.has(agent)) {
      await rm(helperPath, { force: true })
      continue
    }
    await writeAgentMcpHelper(agent, {
      cwd,
      serveCommand,
      mcpServerName,
      claudeConfigPath,
      codexConfigPath,
      kimiConfigPath,
      opencodeConfigPath,
      clineConfigPath,
    })
    agentHelpers.push({
      agent,
      label: AGENT_DESTINATIONS[agent].label,
      path: helperPath,
    })
  }

  await writeFile(
    agentSetupPath,
    agentSetupGuide({
      skillPath,
      audioSkillPath,
      reportSkillPath,
      legalSkillPath,
      mcpConfigPath,
      claudeConfigPath,
      codexConfigPath,
      kimiConfigPath,
      opencodeConfigPath,
      clineConfigPath,
      agentHelpers,
      mcpServerName,
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
      legalSkillPath,
      mcpConfigPath,
      claudeConfigPath,
      codexConfigPath,
      kimiConfigPath,
      opencodeConfigPath,
      clineConfigPath,
      agentSetupPath,
      agentHelpers,
      mcpServerName,
      installAgentCommand: installAgentCommand.display,
      serveCommand: serveCommand.display,
      doctorCommand: doctorCommand.display,
    }),
    "utf8",
  )
  const wroteGitignore = await ensureRagmirGitignore(cwd)

  const written = [
    path.relative(cwd, skillPath),
    path.relative(cwd, audioSkillPath),
    path.relative(cwd, reportSkillPath),
    path.relative(cwd, legalSkillPath),
    path.relative(cwd, runnerPath),
    path.relative(cwd, mcpConfigPath),
    ...agentHelpers.map((helper) => path.relative(cwd, helper.path)),
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
    legalSkillPath,
    mcpConfigPath,
    claudeConfigPath,
    codexConfigPath,
    kimiConfigPath,
    opencodeConfigPath,
    clineConfigPath,
    agentSetupPath,
    readmePath,
    runnerPath,
    agentHelpers,
    mcpServerName,
    mcpCommand: serveCommand.command,
    mcpArgs: serveCommand.args,
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
  const installOptions: InstallSkillOptions = { cwd, agents }
  if (options.targetDir !== undefined) installOptions.targetDir = options.targetDir
  if (options.mcpServerName !== undefined) installOptions.mcpServerName = options.mcpServerName
  if (options.mcpCommand !== undefined) installOptions.mcpCommand = options.mcpCommand
  if (options.mcpArgs !== undefined) installOptions.mcpArgs = options.mcpArgs
  const projectKit = await installSkill(installOptions)
  const sourceDir = path.dirname(projectKit.skillPath)
  const installations: AgentSkillInstallation[] = []
  const written: string[] = []

  for (const agent of agents) {
    const destination = AGENT_DESTINATIONS[agent]
    const targetDir = agentTargetDir(agent, scope, cwd, homeDir, env)
    await mkdir(targetDir, { recursive: true })

    const { mode, skillPaths } = await exposeAgentSkills(
      sourceDir,
      targetDir,
      requestedMode,
      options.force ?? false,
    )
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

  if (scope === "project") {
    const gitignoreEntries = installations.flatMap((installation) =>
      installation.skillPaths.map((skillPath) => posixRelativePath(cwd, skillPath)),
    )
    if (await ensureRagmirGitignore(cwd, gitignoreEntries)) {
      if (!projectKit.written.includes(".gitignore")) {
        projectKit.written.push(".gitignore")
      }
      written.push(".gitignore")
    }
  }

  return {
    projectKit,
    installations,
    written,
  }
}

type McpCommand = Pick<RagmirCommand, "command" | "args" | "display">

interface WriteAgentMcpHelperInput {
  cwd: string
  serveCommand: McpCommand
  mcpServerName: string
  claudeConfigPath: string
  codexConfigPath: string
  kimiConfigPath: string
  opencodeConfigPath: string
  clineConfigPath: string
}

async function resolveMcpCommand(cwd: string, options: InstallSkillOptions): Promise<McpCommand> {
  if (options.mcpCommand === undefined) {
    if (options.mcpArgs !== undefined && options.mcpArgs.length > 0) {
      throw new Error("--mcp-arg requires --mcp-command.")
    }
    return rgrCommand(cwd, ["serve-mcp"])
  }

  const command = options.mcpCommand.trim()
  if (command.length === 0) {
    throw new Error("--mcp-command cannot be empty.")
  }
  const args = [...(options.mcpArgs ?? [])]
  return {
    command,
    args,
    display: formatCommand(command, args),
  }
}

function normalizeMcpServerName(value: string | undefined): string {
  const name = value?.trim() || DEFAULT_MCP_SERVER_NAME
  if (!MCP_SERVER_NAME_PATTERN.test(name)) {
    throw new Error(
      "--mcp-name must contain only letters, numbers, underscores, or hyphens so it can be used in TOML MCP config.",
    )
  }
  return name
}

function suggestedMcpServerName(cwd: string): string {
  const identity = knowledgeBaseIdentity(cwd)
  if (!identity || identity.id === ".") {
    return DEFAULT_MCP_SERVER_NAME
  }
  const suffix = sanitizeMcpServerSuffix(identity.id)
  return suffix ? `${DEFAULT_MCP_SERVER_NAME}-${suffix}` : DEFAULT_MCP_SERVER_NAME
}

function sanitizeMcpServerSuffix(value: string): string {
  let suffix = ""
  let replacingInvalidRun = false

  for (const character of value.toLowerCase()) {
    const code = character.charCodeAt(0)
    const allowed =
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      character === "_" ||
      character === "-"
    if (allowed) {
      suffix += character
      replacingInvalidRun = false
    } else if (!replacingInvalidRun) {
      suffix += "-"
      replacingInvalidRun = true
    }
  }

  let start = 0
  let end = suffix.length
  while (start < end && suffix[start] === "-") {
    start += 1
  }
  while (end > start && suffix[end - 1] === "-") {
    end -= 1
  }
  return suffix.slice(start, end)
}

async function writeAgentMcpHelper(
  agent: AgentTarget,
  input: WriteAgentMcpHelperInput,
): Promise<void> {
  switch (agent) {
    case "claude":
      await writeFile(
        input.claudeConfigPath,
        `${JSON.stringify(claudeMcpServer(input.cwd, input.serveCommand), null, 2)}\n`,
        "utf8",
      )
      return
    case "codex":
      await writeFile(
        input.codexConfigPath,
        codexMcpConfig(input.cwd, input.serveCommand, input.mcpServerName),
        "utf8",
      )
      return
    case "opencode":
      await writeFile(
        input.opencodeConfigPath,
        opencodeConfig(input.cwd, input.serveCommand, input.mcpServerName),
        "utf8",
      )
      return
    case "kimi":
    case "cline":
      await writeFile(
        agent === "kimi" ? input.kimiConfigPath : input.clineConfigPath,
        `${JSON.stringify(
          mcpConfig(
            input.cwd,
            input.serveCommand,
            { [RAGMIR_PROJECT_ROOT_ENV]: input.cwd },
            input.mcpServerName,
          ),
          null,
          2,
        )}\n`,
        "utf8",
      )
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
  force: boolean,
): Promise<{ mode: AgentInstallMode; skillPaths: string[] }> {
  if (requestedMode === "copy") {
    return copyAgentSkills(sourceDir, targetDir, force)
  }

  try {
    return await linkAgentSkills(sourceDir, targetDir, force)
  } catch {
    return copyAgentSkills(sourceDir, targetDir, force)
  }
}

async function linkAgentSkills(
  sourceDir: string,
  targetDir: string,
  force: boolean,
): Promise<{ mode: AgentInstallMode; skillPaths: string[] }> {
  const skillPaths: string[] = []
  for (const skillName of SKILL_NAMES) {
    const source = path.join(sourceDir, skillName)
    const target = path.join(targetDir, skillName)
    await replaceWithDirectorySymlink(source, target, skillName, force)
    skillPaths.push(target)
  }
  return { mode: "link", skillPaths }
}

async function copyAgentSkills(
  sourceDir: string,
  targetDir: string,
  force: boolean,
): Promise<{ mode: AgentInstallMode; skillPaths: string[] }> {
  const skillPaths: string[] = []
  for (const skillName of SKILL_NAMES) {
    const source = path.join(sourceDir, skillName)
    const target = path.join(targetDir, skillName)
    await assertManagedSkillTarget(source, target, skillName, force)
    await rm(target, { recursive: true, force: true })
    await cp(source, target, { recursive: true, force: true })
    await writeFile(
      path.join(target, MANAGED_SKILL_METADATA_FILENAME),
      `${JSON.stringify({ managedBy: "ragmir", skillName }, null, 2)}\n`,
      "utf8",
    )
    skillPaths.push(target)
  }
  return { mode: "copy", skillPaths }
}

async function replaceWithDirectorySymlink(
  source: string,
  target: string,
  skillName: string,
  force: boolean,
): Promise<void> {
  if (path.resolve(source) === path.resolve(target)) {
    return
  }
  await assertManagedSkillTarget(source, target, skillName, force)
  await rm(target, { recursive: true, force: true })
  await symlink(source, target, process.platform === "win32" ? "junction" : "dir")
}

async function assertManagedSkillTarget(
  source: string,
  target: string,
  skillName: string,
  force: boolean,
): Promise<void> {
  let targetStats: Awaited<ReturnType<typeof lstat>>
  try {
    targetStats = await lstat(target)
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return
    throw error
  }

  if (force) return

  if (targetStats.isSymbolicLink()) {
    try {
      if ((await realpath(target)) === (await realpath(source))) return
    } catch {
      // A broken or unreadable link is not safe to replace implicitly.
    }
  } else if (targetStats.isDirectory()) {
    const metadata = await readManagedSkillMetadata(target)
    if (metadata?.managedBy === "ragmir" && metadata.skillName === skillName) return
  }

  throw new Error(
    `Refusing to replace unmanaged agent skill at ${target}. Move it, or rerun with --force after reviewing its contents.`,
  )
}

async function readManagedSkillMetadata(
  target: string,
): Promise<{ managedBy: string; skillName: string } | null> {
  try {
    const value: unknown = JSON.parse(
      await readFile(path.join(target, MANAGED_SKILL_METADATA_FILENAME), "utf8"),
    )
    if (
      typeof value === "object" &&
      value !== null &&
      "managedBy" in value &&
      typeof value.managedBy === "string" &&
      "skillName" in value &&
      typeof value.skillName === "string"
    ) {
      return { managedBy: value.managedBy, skillName: value.skillName }
    }
  } catch {
    return null
  }
  return null
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code
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

function posixRelativePath(cwd: string, filePath: string): string {
  return path.relative(cwd, filePath).split(path.sep).join("/")
}

export function inspectAgentIntegration(
  cwd = process.cwd(),
  homeDir = process.env.HOME ?? process.cwd(),
  env: Record<string, string | undefined> = process.env,
): AgentIntegrationReport {
  const projectRoot = path.resolve(cwd)
  const resolvedHome = path.resolve(homeDir)
  const runnerPath = path.join(projectRoot, RAGMIR_DIR, RGR_RUNNER_FILENAME)
  const probe = probeRagmirRunner(projectRoot, runnerPath)
  const projectAgents = detectedAgentTargets("project", projectRoot, resolvedHome, env)
  const userAgents = detectedAgentTargets("user", projectRoot, resolvedHome, env)
  const nativeAgents = [...new Set([...projectAgents, ...userAgents])]
  const warnings: string[] = []

  if (!existsSync(runnerPath)) {
    warnings.push("The generated Ragmir runner is missing. Run `rgr setup` or `rgr doctor --fix`.")
  } else if (!probe.runnerReady) {
    warnings.push(
      "The generated Ragmir runner could not verify a local CLI. Install @jcode.labs/ragmir in the project or rebuild the workspace package.",
    )
  }
  if (probe.runnerRequiresDownload) {
    warnings.push(
      "The runner will fall back to the pinned npm package and may need a network download before first use.",
    )
  }
  if (nativeAgents.length === 0) {
    warnings.push(
      "No native agent skill exposure was detected. Run `rgr install-agent --agents <list>`.",
    )
  }

  return {
    runnerPath,
    runnerReady: probe.runnerReady,
    runnerMode: probe.runnerMode,
    runnerRequiresDownload: probe.runnerRequiresDownload,
    projectAgents,
    userAgents,
    nativeAgents,
    ready: probe.runnerReady && nativeAgents.length > 0,
    warnings,
  }
}

function detectedAgentTargets(
  scope: AgentInstallScope,
  projectRoot: string,
  homeDir: string,
  env: Record<string, string | undefined>,
): AgentTarget[] {
  return SUPPORTED_AGENT_TARGETS.filter((agent) => {
    const targetDir = agentTargetDir(agent, scope, projectRoot, homeDir, env)
    return SKILL_NAMES.every((skillName) => existsSync(path.join(targetDir, skillName, "SKILL.md")))
  })
}

function probeRagmirRunner(
  projectRoot: string,
  runnerPath: string,
): Pick<AgentIntegrationReport, "runnerReady" | "runnerMode" | "runnerRequiresDownload"> {
  if (!existsSync(runnerPath)) {
    return { runnerReady: false, runnerMode: null, runnerRequiresDownload: false }
  }

  const result = spawnSync(process.execPath, [runnerPath, RGR_RUNNER_PROBE_ARG], {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 5_000,
    env: { ...process.env, [RAGMIR_PROJECT_ROOT_ENV]: projectRoot },
  })
  if (result.status !== 0) {
    return { runnerReady: false, runnerMode: null, runnerRequiresDownload: false }
  }

  try {
    const value: unknown = JSON.parse(result.stdout.trim())
    if (
      typeof value === "object" &&
      value !== null &&
      "verified" in value &&
      typeof value.verified === "boolean" &&
      "mode" in value &&
      isRagmirRunnerMode(value.mode) &&
      "requiresDownload" in value &&
      typeof value.requiresDownload === "boolean"
    ) {
      return {
        runnerReady: value.verified,
        runnerMode: value.mode,
        runnerRequiresDownload: value.requiresDownload,
      }
    }
  } catch {
    return { runnerReady: false, runnerMode: null, runnerRequiresDownload: false }
  }

  return { runnerReady: false, runnerMode: null, runnerRequiresDownload: false }
}

function isRagmirRunnerMode(value: unknown): value is RagmirRunnerMode {
  return (
    value === "local-bin" ||
    value === "workspace" ||
    value === "installed-package" ||
    value === "npm-cache"
  )
}

function ragmirRunnerSource(version: string, installedCliPath: string): string {
  const packageSpec = `@jcode.labs/ragmir@${version}`
  return `#!/usr/bin/env node
const { spawnSync } = require("node:child_process")
const { existsSync, readFileSync } = require("node:fs")
const path = require("node:path")
const { pathToFileURL } = require("node:url")

const PACKAGE_SPEC = ${JSON.stringify(packageSpec)}
const INSTALLED_CLI = ${JSON.stringify(installedCliPath)}
const PROBE_ARG = ${JSON.stringify(RGR_RUNNER_PROBE_ARG)}
const projectRoot = path.resolve(process.env.${RAGMIR_PROJECT_ROOT_ENV} || process.cwd())

function isRagmirWorkspaceCli(cliPath) {
  if (!existsSync(cliPath)) return false
  try {
    const manifestPath = path.join(path.dirname(path.dirname(cliPath)), "package.json")
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
    return manifest.name === "@jcode.labs/ragmir"
  } catch {
    return false
  }
}

function resolveCommand() {
  const workspaceCli = path.join(projectRoot, "packages", "ragmir-core", "dist", "cli-entry.js")
  if (isRagmirWorkspaceCli(workspaceCli)) {
    return {
      mode: "workspace",
      command: process.execPath,
      args: [workspaceCli],
      requiresDownload: false,
    }
  }

  if (isRagmirWorkspaceCli(INSTALLED_CLI)) {
    return {
      mode: "installed-package",
      command: process.execPath,
      args: [INSTALLED_CLI],
      requiresDownload: false,
    }
  }

  const localBin = path.join(
    projectRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "rgr.cmd" : "rgr",
  )
  if (existsSync(localBin)) {
    return { mode: "local-bin", command: localBin, args: [], requiresDownload: false }
  }

  return {
    mode: "npm-cache",
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["--yes", "--package", PACKAGE_SPEC, "rgr"],
    requiresDownload: true,
  }
}

function canImportDirectly(selection) {
  return (
    (selection.mode === "workspace" || selection.mode === "installed-package") &&
    selection.command === process.execPath &&
    selection.args.length === 1
  )
}

async function runDirect(selection, commandArgs) {
  const cliPath = selection.args[0]
  process.chdir(projectRoot)
  process.env.${RAGMIR_PROJECT_ROOT_ENV} = projectRoot
  process.argv = [process.execPath, cliPath, ...commandArgs]
  await import(pathToFileURL(cliPath).href)
}

const selected = resolveCommand()
const commandArgs = process.argv.slice(2)

if (commandArgs[0] === PROBE_ARG) {
  const probeArgs = selected.mode === "npm-cache" ? ["--version"] : [...selected.args, "--version"]
  const probe = spawnSync(selected.command, probeArgs, {
    cwd: projectRoot,
    stdio: "ignore",
    env: { ...process.env, ${RAGMIR_PROJECT_ROOT_ENV}: projectRoot },
  })
  const available = probe.status === 0
  console.log(
    JSON.stringify({
      available,
      verified: available && selected.mode !== "npm-cache",
      mode: selected.mode,
      requiresDownload: selected.requiresDownload,
    }),
  )
  process.exitCode = available ? 0 : 1
} else if (canImportDirectly(selected)) {
  runDirect(selected, commandArgs).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
} else {
  const result = spawnSync(selected.command, [...selected.args, ...commandArgs], {
    cwd: projectRoot,
    stdio: "inherit",
    env: { ...process.env, ${RAGMIR_PROJECT_ROOT_ENV}: projectRoot },
  })
  if (result.error) {
    console.error(result.error.message)
    process.exitCode = 1
  } else {
    process.exitCode = result.status ?? 1
  }
}
`
}

function mcpConfig(
  cwd: string,
  serveCommand: McpCommand,
  env?: Record<string, string>,
  serverName = DEFAULT_MCP_SERVER_NAME,
): unknown {
  const serverConfig: {
    command: string
    args: string[]
    cwd: string
    env?: Record<string, string>
  } = {
    command: serveCommand.command,
    args: serveCommand.args,
    cwd,
  }
  const config: {
    mcpServers: Record<
      string,
      {
        command: string
        args: string[]
        cwd: string
        env?: Record<string, string>
      }
    >
  } = {
    mcpServers: {
      [serverName]: serverConfig,
    },
  }
  if (env) {
    serverConfig.env = env
  }
  return config
}

function claudeMcpServer(cwd: string, serveCommand: McpCommand): unknown {
  return {
    type: "stdio",
    command: serveCommand.command,
    args: serveCommand.args,
    env: { [RAGMIR_PROJECT_ROOT_ENV]: cwd },
  }
}

function codexMcpConfig(
  cwd: string,
  serveCommand: McpCommand,
  serverName = DEFAULT_MCP_SERVER_NAME,
): string {
  return `[mcp_servers.${serverName}]
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

[[skills.config]]
path = ${tomlString(path.join(cwd, DEFAULT_SKILL_TARGET_DIR, LEGAL_SKILL_NAME))}
enabled = true

`
}

function opencodeConfig(
  cwd: string,
  serveCommand: McpCommand,
  serverName = DEFAULT_MCP_SERVER_NAME,
): string {
  const config = {
    $schema: "https://opencode.ai/config.json",
    mcp: {
      [serverName]: {
        type: "local",
        command: [serveCommand.command, ...serveCommand.args],
        enabled: true,
        environment: {
          [RAGMIR_PROJECT_ROOT_ENV]: cwd,
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

function formatCommand(command: string, args: readonly string[]): string {
  return [command, ...args].map(formatCommandArg).join(" ")
}

function formatCommandArg(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/u.test(value) ? value : JSON.stringify(value)
}

interface McpHelperGuideInput {
  mcpConfigPath: string
  claudeConfigPath: string
  codexConfigPath: string
  kimiConfigPath: string
  opencodeConfigPath: string
  clineConfigPath: string
  agentHelpers: readonly AgentHelperFile[]
  mcpServerName: string
  serveCommand: string
}

function mcpHelperGuide(input: McpHelperGuideInput): string {
  const sections = [
    `Generic MCP config for server \`${input.mcpServerName}\`:

\`\`\`plain text
${input.mcpConfigPath}
\`\`\`

Use the MCP server when your agent supports MCP tools. The server command is:

\`\`\`bash
${input.serveCommand}
\`\`\`

Use \`ragmir_route_prompt\` when an agent hook or skill needs to decide whether the current user
prompt should call Ragmir before answering. The router is local and does not store prompt text.`,
    `This helper is pinned to one knowledge-base root. In a monorepo, keep the generated server name
\`${input.mcpServerName}\` and generate a separate helper from each nested base. Call
\`ragmir_status\` and verify \`knowledgeBaseId\` before retrieval when the active base is unclear.`,
    "Read `ragmir://context` for bounded base identity, readiness, freshness, and capabilities. Read `ragmir://sources` only when source coverage or index drift matters.",
  ]

  if (hasAgentHelper(input, "claude")) {
    sections.push(`Claude Code local MCP setup:

\`\`\`bash
claude mcp add-json --scope local ${input.mcpServerName} "$(cat ${RAGMIR_DIR}/claude-mcp-server.json)"
\`\`\`

Run that command from this repository root. Ragmir also reads \`CLAUDE_PROJECT_DIR\`, so the server
uses the active Claude Code project as the knowledge-base root.`)
  }

  if (hasAgentHelper(input, "codex")) {
    sections.push(`Codex setup:

\`\`\`plain text
${input.codexConfigPath}
\`\`\`

Copy that TOML snippet into \`~/.codex/config.toml\` or another trusted Codex config layer.`)
  }

  if (hasAgentHelper(input, "kimi")) {
    sections.push(`Kimi Code CLI setup:

\`\`\`bash
kimi --mcp-config-file ${input.kimiConfigPath}
\`\`\``)
  }

  if (hasAgentHelper(input, "opencode")) {
    sections.push(`OpenCode setup:

\`\`\`plain text
${input.opencodeConfigPath}
\`\`\``)
  }

  if (hasAgentHelper(input, "cline")) {
    sections.push(`Cline setup:

\`\`\`plain text
${input.clineConfigPath}
\`\`\``)
  }

  const missingAgents = SUPPORTED_AGENT_TARGETS.filter((agent) => !hasAgentHelper(input, agent))
  if (missingAgents.length > 0) {
    sections.push(
      "Only selected MCP helper files were generated. Re-run setup or install-skill with `--agents all` if this repository later needs every supported agent helper.",
    )
  }

  sections.push(
    "For other MCP clients that cannot set a working directory, launch the server with `RAGMIR_PROJECT_ROOT=/absolute/path/to/repository`.",
  )

  return sections.join("\n\n")
}

function hasAgentHelper(input: McpHelperGuideInput, agent: AgentTarget): boolean {
  return input.agentHelpers.some((helper) => helper.agent === agent)
}

function installAgentCommandExample(command: string, agents: string): string {
  return command.replace(/--agents [^\s]+/u, `--agents ${agents}`)
}

interface AgentKitReadmeInput {
  skillPath: string
  audioSkillPath: string
  reportSkillPath: string
  legalSkillPath: string
  mcpConfigPath: string
  claudeConfigPath: string
  codexConfigPath: string
  kimiConfigPath: string
  opencodeConfigPath: string
  clineConfigPath: string
  agentSetupPath: string
  agentHelpers: readonly AgentHelperFile[]
  mcpServerName: string
  installAgentCommand: string
  serveCommand: string
  doctorCommand: string
}

function agentKitReadme(input: AgentKitReadmeInput): string {
  return `# Ragmir Agent Kit

This folder contains portable agent instructions for Ragmir.

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
local Ragmir state by default. Use Transformers.js WAV for confidential content and Edge MP3 only
when online TTS is explicitly acceptable.

Optional Markdown-report skill folder:

\`\`\`plain text
${input.reportSkillPath}
\`\`\`

Use it when the user asks for a cited Markdown report, dossier, audit memo, or planning note. It
writes reports under ignored local Ragmir state by default.

Optional legal-dossier skill folder:

\`\`\`plain text
${input.legalSkillPath}
\`\`\`

Use it when the user asks for legal chronology, clause review, evidence tables, or professional
handoff notes. It prepares cited work products only; it does not provide final legal advice.

## MCP

${mcpHelperGuide(input)}

## Native Agent Setup

For automatic skill discovery in one or more supported agents, run:

\`\`\`bash
${input.installAgentCommand}
\`\`\`

Use \`--agents claude\`, \`--agents kimi\`, or a comma-separated list when the user only uses one
agent. Use \`--scope user\` for global installs and \`--scope project\` for repository-local agent
folders. By default, native agent folders link back to \`.ragmir/skills/\` so there is one source of
truth. Use \`--mode copy\` only when an agent or filesystem cannot follow symlinks.

Detailed setup notes:

\`\`\`plain text
${input.agentSetupPath}
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
  legalSkillPath: string
  mcpConfigPath: string
  claudeConfigPath: string
  codexConfigPath: string
  kimiConfigPath: string
  opencodeConfigPath: string
  clineConfigPath: string
  agentHelpers: readonly AgentHelperFile[]
  mcpServerName: string
  installAgentCommand: string
  serveCommand: string
  doctorCommand: string
}

function agentSetupGuide(input: AgentSetupGuideInput): string {
  return `# Ragmir Agent Setup

Ragmir keeps the repository-local source of truth under \`.ragmir/skills/\`. Native agent folders link
to that source by default, so there is one original version to update. Install only the agents you
use.

## Install Native Skills

\`\`\`bash
${input.installAgentCommand}
\`\`\`

Examples:

\`\`\`bash
${installAgentCommandExample(input.installAgentCommand, "claude")}
${installAgentCommandExample(input.installAgentCommand, "kimi")}
${installAgentCommandExample(input.installAgentCommand, "claude,codex,kimi,opencode,cline")}
${installAgentCommandExample(input.installAgentCommand, "cline")} --mode copy
\`\`\`

Default project-scope targets:

| Agent | Project skill directory | User skill directory |
| --- | --- | --- |
| Claude Code | \`.claude/skills/\` | \`~/.claude/skills/\` |
| Codex | \`.agents/skills/\` | \`~/.agents/skills/\` |
| Kimi Code CLI | \`.kimi/skills/\` | \`~/.kimi/skills/\` |
| OpenCode | \`.opencode/skills/\` | \`~/.config/opencode/skills/\` |
| Cline | \`.cline/skills/\` | \`~/.cline/skills/\` |

Override paths with \`CLAUDE_SKILLS_DIR\`, \`CODEX_SKILLS_DIR\`, \`KIMI_SKILLS_DIR\`,
\`OPENCODE_SKILLS_DIR\`, or \`CLINE_SKILLS_DIR\`.

Use \`--mode copy\` only when an agent runtime does not follow symlinked skill directories. When using
copy mode, rerun \`install-agent\` after refreshing \`.ragmir/skills/\`. Ragmir refuses to replace
an unmanaged same-name skill by default; use \`--force\` only after reviewing that existing folder.

## Skill Folders

\`\`\`plain text
${input.skillPath}
${input.audioSkillPath}
${input.reportSkillPath}
${input.legalSkillPath}
\`\`\`

## MCP Helpers

${mcpHelperGuide(input)}

Before relying on retrieved context, run:

\`\`\`bash
${input.doctorCommand}
\`\`\`

`
}

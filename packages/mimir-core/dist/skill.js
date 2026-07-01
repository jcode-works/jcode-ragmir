import { cp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SKILL_TARGET_DIR, MIMIR_DIR } from "./defaults.js";
import { ensureMimirGitignore } from "./gitignore.js";
import { mimirCommand } from "./package-manager.js";
const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PRIMARY_SKILL_NAME = "mimir";
const AUDIO_SKILL_NAME = "mimir-audio-summary";
const REPORT_SKILL_NAME = "mimir-markdown-report";
const LEGAL_SKILL_NAME = "mimir-legal-dossier";
const DEFAULT_MCP_SERVER_NAME = "mimir";
const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]+$/u;
const SKILL_NAMES = [
    PRIMARY_SKILL_NAME,
    AUDIO_SKILL_NAME,
    REPORT_SKILL_NAME,
    LEGAL_SKILL_NAME,
];
export const SUPPORTED_AGENT_TARGETS = [
    "claude",
    "codex",
    "kimi",
    "opencode",
    "cline",
];
const AGENT_TARGET_ALIASES = new Map([
    ["claude", "claude"],
    ["claude-code", "claude"],
    ["codex", "codex"],
    ["kimi", "kimi"],
    ["kimi-code", "kimi"],
    ["opencode", "opencode"],
    ["open-code", "opencode"],
    ["cline", "cline"],
]);
const AGENT_DESTINATIONS = {
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
};
export function bundledSkillPath(skillName = PRIMARY_SKILL_NAME) {
    return path.join(PACKAGE_ROOT, "skills", skillName);
}
export function parseAgentTargets(value) {
    if (value === undefined || value === "" || value === "all") {
        return [...SUPPORTED_AGENT_TARGETS];
    }
    const entries = typeof value === "string" ? value.split(",") : value.flatMap((entry) => entry.split(","));
    const targets = new Set();
    for (const entry of entries) {
        const normalized = entry.trim().toLowerCase();
        if (normalized === "" || normalized === "all") {
            for (const target of SUPPORTED_AGENT_TARGETS) {
                targets.add(target);
            }
            continue;
        }
        const target = AGENT_TARGET_ALIASES.get(normalized);
        if (!target) {
            throw new Error(`Unknown agent target "${entry}". Expected one of: all, ${SUPPORTED_AGENT_TARGETS.join(", ")}.`);
        }
        targets.add(target);
    }
    return [...targets];
}
export async function installSkill(options = {}) {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const targetDir = path.resolve(cwd, options.targetDir ?? DEFAULT_SKILL_TARGET_DIR);
    const agents = options.agents ? parseAgentTargets(options.agents) : [...SUPPORTED_AGENT_TARGETS];
    const agentSet = new Set(agents);
    const mcpServerName = normalizeMcpServerName(options.mcpServerName);
    const skillPath = path.join(targetDir, PRIMARY_SKILL_NAME);
    const audioSkillPath = path.join(targetDir, AUDIO_SKILL_NAME);
    const reportSkillPath = path.join(targetDir, REPORT_SKILL_NAME);
    const legalSkillPath = path.join(targetDir, LEGAL_SKILL_NAME);
    const mimirDir = path.resolve(cwd, MIMIR_DIR);
    const mcpConfigPath = path.join(mimirDir, "mcp.json");
    const claudeConfigPath = path.join(mimirDir, "claude-mcp-server.json");
    const codexConfigPath = path.join(mimirDir, "codex-mcp.toml");
    const kimiConfigPath = path.join(mimirDir, "kimi-mcp.json");
    const opencodeConfigPath = path.join(mimirDir, "opencode.jsonc");
    const clineConfigPath = path.join(mimirDir, "cline-mcp.json");
    const agentSetupPath = path.join(mimirDir, "agent-setup.md");
    const readmePath = path.join(mimirDir, "README.md");
    const agentConfigPaths = {
        claude: claudeConfigPath,
        codex: codexConfigPath,
        kimi: kimiConfigPath,
        opencode: opencodeConfigPath,
        cline: clineConfigPath,
    };
    await mkdir(targetDir, { recursive: true });
    await mkdir(mimirDir, { recursive: true });
    await copyBundledSkills(targetDir);
    const serveCommand = await resolveMcpCommand(cwd, options);
    const doctorCommand = await mimirCommand(cwd, ["doctor"]);
    const installAgentCommand = await mimirCommand(cwd, [
        "install-agent",
        "--agents",
        agents.join(","),
    ]);
    await writeFile(mcpConfigPath, `${JSON.stringify(mcpConfig(cwd, serveCommand, undefined, mcpServerName), null, 2)}\n`, "utf8");
    const agentHelpers = [];
    for (const agent of SUPPORTED_AGENT_TARGETS) {
        const helperPath = agentConfigPaths[agent];
        if (!agentSet.has(agent)) {
            await rm(helperPath, { force: true });
            continue;
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
        });
        agentHelpers.push({
            agent,
            label: AGENT_DESTINATIONS[agent].label,
            path: helperPath,
        });
    }
    await writeFile(agentSetupPath, agentSetupGuide({
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
    }), "utf8");
    await writeFile(readmePath, agentKitReadme({
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
    }), "utf8");
    const wroteGitignore = await ensureMimirGitignore(cwd);
    const written = [
        path.relative(cwd, skillPath),
        path.relative(cwd, audioSkillPath),
        path.relative(cwd, reportSkillPath),
        path.relative(cwd, legalSkillPath),
        path.relative(cwd, mcpConfigPath),
        ...agentHelpers.map((helper) => path.relative(cwd, helper.path)),
        path.relative(cwd, agentSetupPath),
        path.relative(cwd, readmePath),
    ];
    if (wroteGitignore) {
        written.push(".gitignore");
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
        agentHelpers,
        mcpServerName,
        mcpCommand: serveCommand.command,
        mcpArgs: serveCommand.args,
        written,
    };
}
export async function installAgentSkills(options = {}) {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const scope = options.scope ?? "project";
    const requestedMode = options.mode ?? "link";
    const homeDir = path.resolve(options.homeDir ?? process.env.HOME ?? process.cwd());
    const env = options.env ?? process.env;
    const agents = options.agents ?? SUPPORTED_AGENT_TARGETS;
    const projectKit = await installSkill({ cwd, agents });
    const sourceDir = path.dirname(projectKit.skillPath);
    const installations = [];
    const written = [];
    for (const agent of agents) {
        const destination = AGENT_DESTINATIONS[agent];
        const targetDir = agentTargetDir(agent, scope, cwd, homeDir, env);
        await mkdir(targetDir, { recursive: true });
        const { mode, skillPaths } = await exposeAgentSkills(sourceDir, targetDir, requestedMode);
        written.push(...skillPaths.map((skillPath) => displayPath(cwd, skillPath)));
        installations.push({
            agent,
            label: destination.label,
            scope,
            mode,
            targetDir,
            skillPaths,
        });
    }
    return {
        projectKit,
        installations,
        written,
    };
}
async function resolveMcpCommand(cwd, options) {
    if (options.mcpCommand === undefined) {
        if (options.mcpArgs !== undefined && options.mcpArgs.length > 0) {
            throw new Error("--mcp-arg requires --mcp-command.");
        }
        return mimirCommand(cwd, ["serve-mcp"]);
    }
    const command = options.mcpCommand.trim();
    if (command.length === 0) {
        throw new Error("--mcp-command cannot be empty.");
    }
    const args = [...(options.mcpArgs ?? [])];
    return {
        command,
        args,
        display: formatCommand(command, args),
    };
}
function normalizeMcpServerName(value) {
    const name = value?.trim() || DEFAULT_MCP_SERVER_NAME;
    if (!MCP_SERVER_NAME_PATTERN.test(name)) {
        throw new Error("--mcp-name must contain only letters, numbers, underscores, or hyphens so it can be used in TOML MCP config.");
    }
    return name;
}
async function writeAgentMcpHelper(agent, input) {
    switch (agent) {
        case "claude":
            await writeFile(input.claudeConfigPath, `${JSON.stringify(claudeMcpServer(input.serveCommand), null, 2)}\n`, "utf8");
            return;
        case "codex":
            await writeFile(input.codexConfigPath, codexMcpConfig(input.cwd, input.serveCommand, input.mcpServerName), "utf8");
            return;
        case "kimi":
            await writeFile(input.kimiConfigPath, `${JSON.stringify(mcpConfig(input.cwd, input.serveCommand, { MIMIR_PROJECT_ROOT: input.cwd }, input.mcpServerName), null, 2)}\n`, "utf8");
            return;
        case "opencode":
            await writeFile(input.opencodeConfigPath, opencodeConfig(input.cwd, input.serveCommand, input.mcpServerName), "utf8");
            return;
        case "cline":
            await writeFile(input.clineConfigPath, `${JSON.stringify(mcpConfig(input.cwd, input.serveCommand, { MIMIR_PROJECT_ROOT: input.cwd }, input.mcpServerName), null, 2)}\n`, "utf8");
    }
}
async function copyBundledSkills(targetDir) {
    await Promise.all(SKILL_NAMES.map((skillName) => cp(bundledSkillPath(skillName), path.join(targetDir, skillName), {
        recursive: true,
        force: true,
    })));
}
async function exposeAgentSkills(sourceDir, targetDir, requestedMode) {
    if (requestedMode === "copy") {
        return copyAgentSkills(sourceDir, targetDir);
    }
    try {
        return await linkAgentSkills(sourceDir, targetDir);
    }
    catch {
        return copyAgentSkills(sourceDir, targetDir);
    }
}
async function linkAgentSkills(sourceDir, targetDir) {
    const skillPaths = [];
    for (const skillName of SKILL_NAMES) {
        const source = path.join(sourceDir, skillName);
        const target = path.join(targetDir, skillName);
        await replaceWithDirectorySymlink(source, target);
        skillPaths.push(target);
    }
    return { mode: "link", skillPaths };
}
async function copyAgentSkills(sourceDir, targetDir) {
    const skillPaths = [];
    for (const skillName of SKILL_NAMES) {
        const source = path.join(sourceDir, skillName);
        const target = path.join(targetDir, skillName);
        await rm(target, { recursive: true, force: true });
        await cp(source, target, { recursive: true, force: true });
        skillPaths.push(target);
    }
    return { mode: "copy", skillPaths };
}
async function replaceWithDirectorySymlink(source, target) {
    if (path.resolve(source) === path.resolve(target)) {
        return;
    }
    await rm(target, { recursive: true, force: true });
    await symlink(source, target, process.platform === "win32" ? "junction" : "dir");
}
function agentTargetDir(agent, scope, cwd, homeDir, env) {
    const destination = AGENT_DESTINATIONS[agent];
    const override = env[destination.env];
    if (override) {
        return path.resolve(expandHome(override, homeDir));
    }
    if (scope === "project") {
        return path.resolve(cwd, destination.projectDir);
    }
    return destination.userDir(homeDir);
}
function expandHome(input, homeDir) {
    if (input === "~") {
        return homeDir;
    }
    if (input.startsWith("~/")) {
        return path.join(homeDir, input.slice(2));
    }
    return input;
}
function displayPath(cwd, filePath) {
    const relative = path.relative(cwd, filePath);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
        return relative;
    }
    return filePath;
}
function mcpConfig(cwd, serveCommand, env, serverName = DEFAULT_MCP_SERVER_NAME) {
    const serverConfig = {
        command: serveCommand.command,
        args: serveCommand.args,
        cwd,
    };
    const config = {
        mcpServers: {
            [serverName]: serverConfig,
        },
    };
    if (env) {
        serverConfig.env = env;
    }
    return config;
}
function claudeMcpServer(serveCommand) {
    return {
        type: "stdio",
        command: serveCommand.command,
        args: serveCommand.args,
    };
}
function codexMcpConfig(cwd, serveCommand, serverName = DEFAULT_MCP_SERVER_NAME) {
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

`;
}
function opencodeConfig(cwd, serveCommand, serverName = DEFAULT_MCP_SERVER_NAME) {
    const config = {
        $schema: "https://opencode.ai/config.json",
        mcp: {
            [serverName]: {
                type: "local",
                command: [serveCommand.command, ...serveCommand.args],
                enabled: true,
                environment: {
                    MIMIR_PROJECT_ROOT: cwd,
                },
            },
        },
    };
    return `${JSON.stringify(config, null, 2)}\n`;
}
function tomlArray(values) {
    return `[${values.map(tomlString).join(", ")}]`;
}
function tomlString(value) {
    return JSON.stringify(value);
}
function formatCommand(command, args) {
    return [command, ...args].map(formatCommandArg).join(" ");
}
function formatCommandArg(value) {
    return /^[A-Za-z0-9_./:@%+=,-]+$/u.test(value) ? value : JSON.stringify(value);
}
function mcpHelperGuide(input) {
    const sections = [
        `Generic MCP config for server \`${input.mcpServerName}\`:

\`\`\`plain text
${input.mcpConfigPath}
\`\`\`

Use the MCP server when your agent supports MCP tools. The server command is:

\`\`\`bash
${input.serveCommand}
\`\`\``,
    ];
    if (hasAgentHelper(input, "claude")) {
        sections.push(`Claude Code local MCP setup:

\`\`\`bash
claude mcp add-json --scope local ${input.mcpServerName} "$(cat ${MIMIR_DIR}/claude-mcp-server.json)"
\`\`\`

Run that command from this repository root. Mimir also reads \`CLAUDE_PROJECT_DIR\`, so the server
uses the active Claude Code project as the knowledge-base root.`);
    }
    if (hasAgentHelper(input, "codex")) {
        sections.push(`Codex setup:

\`\`\`plain text
${input.codexConfigPath}
\`\`\`

Copy that TOML snippet into \`~/.codex/config.toml\` or another trusted Codex config layer.`);
    }
    if (hasAgentHelper(input, "kimi")) {
        sections.push(`Kimi Code CLI setup:

\`\`\`bash
kimi --mcp-config-file ${input.kimiConfigPath}
\`\`\``);
    }
    if (hasAgentHelper(input, "opencode")) {
        sections.push(`OpenCode setup:

\`\`\`plain text
${input.opencodeConfigPath}
\`\`\``);
    }
    if (hasAgentHelper(input, "cline")) {
        sections.push(`Cline setup:

\`\`\`plain text
${input.clineConfigPath}
\`\`\``);
    }
    const missingAgents = SUPPORTED_AGENT_TARGETS.filter((agent) => !hasAgentHelper(input, agent));
    if (missingAgents.length > 0) {
        sections.push("Only selected MCP helper files were generated. Re-run setup or install-skill with `--agents all` if this repository later needs every supported agent helper.");
    }
    sections.push("For other MCP clients that cannot set a working directory, launch the server with `MIMIR_PROJECT_ROOT=/absolute/path/to/repository`.");
    return sections.join("\n\n");
}
function hasAgentHelper(input, agent) {
    return input.agentHelpers.some((helper) => helper.agent === agent);
}
function installAgentCommandExample(command, agents) {
    return command.replace(/--agents [^\s]+/u, `--agents ${agents}`);
}
function agentKitReadme(input) {
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
folders. By default, native agent folders link back to \`.mimir/skills/\` so there is one source of
truth. Use \`--mode copy\` only when an agent or filesystem cannot follow symlinks.

Detailed setup notes:

\`\`\`plain text
${input.agentSetupPath}
\`\`\`

Before relying on retrieved context, run:

\`\`\`bash
${input.doctorCommand}
\`\`\`

`;
}
function agentSetupGuide(input) {
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
${installAgentCommandExample(input.installAgentCommand, "claude")}
${installAgentCommandExample(input.installAgentCommand, "kimi")}
${installAgentCommandExample(input.installAgentCommand, "claude,codex,kimi,opencode,cline")}
${installAgentCommandExample(input.installAgentCommand, "cline")} --mode copy
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
${input.legalSkillPath}
\`\`\`

## MCP Helpers

${mcpHelperGuide(input)}

Before relying on retrieved context, run:

\`\`\`bash
${input.doctorCommand}
\`\`\`

`;
}
//# sourceMappingURL=skill.js.map
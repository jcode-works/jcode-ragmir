import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SKILL_TARGET_DIR, MIMIR_DIR } from "./defaults.js";
import { ensureMimirGitignore } from "./gitignore.js";
import { kbCommand } from "./package-manager.js";
const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PRIMARY_SKILL_NAME = "mimir";
const AUDIO_SKILL_NAME = "mimir-audio-summary";
const REPORT_SKILL_NAME = "mimir-markdown-report";
export function bundledSkillPath(skillName = PRIMARY_SKILL_NAME) {
    return path.join(PACKAGE_ROOT, "skills", skillName);
}
export async function installSkill(options = {}) {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const targetDir = path.resolve(cwd, options.targetDir ?? DEFAULT_SKILL_TARGET_DIR);
    const skillPath = path.join(targetDir, PRIMARY_SKILL_NAME);
    const audioSkillPath = path.join(targetDir, AUDIO_SKILL_NAME);
    const reportSkillPath = path.join(targetDir, REPORT_SKILL_NAME);
    const mimirDir = path.resolve(cwd, MIMIR_DIR);
    const mcpConfigPath = path.join(mimirDir, "mcp.json");
    const claudeConfigPath = path.join(mimirDir, "claude-mcp-server.json");
    const codexConfigPath = path.join(mimirDir, "codex-mcp.toml");
    const readmePath = path.join(mimirDir, "README.md");
    await mkdir(targetDir, { recursive: true });
    await mkdir(mimirDir, { recursive: true });
    await cp(bundledSkillPath(PRIMARY_SKILL_NAME), skillPath, { recursive: true, force: true });
    await cp(bundledSkillPath(AUDIO_SKILL_NAME), audioSkillPath, { recursive: true, force: true });
    await cp(bundledSkillPath(REPORT_SKILL_NAME), reportSkillPath, {
        recursive: true,
        force: true,
    });
    const serveCommand = await kbCommand(cwd, ["serve-mcp"]);
    const doctorCommand = await kbCommand(cwd, ["doctor"]);
    await writeFile(mcpConfigPath, `${JSON.stringify(mcpConfig(cwd, serveCommand), null, 2)}\n`, "utf8");
    await writeFile(claudeConfigPath, `${JSON.stringify(claudeMcpServer(serveCommand), null, 2)}\n`, "utf8");
    await writeFile(codexConfigPath, codexMcpConfig(cwd, serveCommand), "utf8");
    await writeFile(readmePath, agentKitReadme(skillPath, audioSkillPath, reportSkillPath, mcpConfigPath, codexConfigPath, serveCommand.display, doctorCommand.display), "utf8");
    const wroteGitignore = await ensureMimirGitignore(cwd);
    const written = [
        path.relative(cwd, skillPath),
        path.relative(cwd, audioSkillPath),
        path.relative(cwd, reportSkillPath),
        path.relative(cwd, mcpConfigPath),
        path.relative(cwd, claudeConfigPath),
        path.relative(cwd, codexConfigPath),
        path.relative(cwd, readmePath),
    ];
    if (wroteGitignore) {
        written.push(".gitignore");
    }
    return {
        skillPath,
        audioSkillPath,
        reportSkillPath,
        mcpConfigPath,
        claudeConfigPath,
        codexConfigPath,
        readmePath,
        written,
    };
}
function mcpConfig(cwd, serveCommand) {
    return {
        mcpServers: {
            mimir: {
                command: serveCommand.command,
                args: serveCommand.args,
                cwd,
            },
        },
    };
}
function claudeMcpServer(serveCommand) {
    return {
        type: "stdio",
        command: serveCommand.command,
        args: serveCommand.args,
    };
}
function codexMcpConfig(cwd, serveCommand) {
    return `[mcp_servers.mimir]
command = ${tomlString(serveCommand.command)}
args = ${tomlArray(serveCommand.args)}
cwd = ${tomlString(cwd)}

`;
}
function tomlArray(values) {
    return `[${values.map(tomlString).join(", ")}]`;
}
function tomlString(value) {
    return JSON.stringify(value);
}
function agentKitReadme(skillPath, audioSkillPath, reportSkillPath, mcpConfigPath, codexConfigPath, serveCommand, doctorCommand) {
    return `# Mimir Agent Kit

This folder contains portable agent instructions for Mimir.

## Skill

Skill folder:

\`\`\`plain text
${skillPath}
\`\`\`

Agents that support skill folders can load that folder directly.

Optional audio-summary skill folder:

\`\`\`plain text
${audioSkillPath}
\`\`\`

Use it only when the user asks for a listenable summary. It renders generated audio under ignored
local Mimir state by default. Use Transformers.js WAV for confidential content and Edge MP3 only
when online TTS is explicitly acceptable.

Optional Markdown-report skill folder:

\`\`\`plain text
${reportSkillPath}
\`\`\`

Use it when the user asks for a cited Markdown report, dossier, audit memo, or planning note. It
writes reports under ignored local Mimir state by default.

## MCP

MCP config example:

\`\`\`plain text
${mcpConfigPath}
\`\`\`

Use the MCP server when your agent supports MCP tools. The server command is:

\`\`\`bash
${serveCommand}
\`\`\`

Claude Code local setup:

\`\`\`bash
claude mcp add-json --scope local mimir "$(cat ${MIMIR_DIR}/claude-mcp-server.json)"
\`\`\`

Run that command from this repository root. Mimir also reads \`CLAUDE_PROJECT_DIR\`, so the server
uses the active Claude Code project as the knowledge-base root.

For other MCP clients that cannot set a working directory, launch the server with
\`MIMIR_PROJECT_ROOT=/absolute/path/to/repository\`.

Codex setup:

\`\`\`plain text
${codexConfigPath}
\`\`\`

Copy that TOML snippet into \`~/.codex/config.toml\` or another trusted Codex config layer.

Before relying on retrieved context, run:

\`\`\`bash
${doctorCommand}
\`\`\`

`;
}
//# sourceMappingURL=skill.js.map
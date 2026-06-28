import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SKILL_TARGET_DIR, MIMIR_DIR } from "./defaults.js";
import { ensureMimirGitignore } from "./gitignore.js";
const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PRIMARY_SKILL_NAME = "mimir";
const AUDIO_SKILL_NAME = "mimir-audio-summary";
export function bundledSkillPath(skillName = PRIMARY_SKILL_NAME) {
    return path.join(PACKAGE_ROOT, "skills", skillName);
}
export async function installSkill(options = {}) {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const targetDir = path.resolve(cwd, options.targetDir ?? DEFAULT_SKILL_TARGET_DIR);
    const skillPath = path.join(targetDir, PRIMARY_SKILL_NAME);
    const audioSkillPath = path.join(targetDir, AUDIO_SKILL_NAME);
    const mimirDir = path.resolve(cwd, MIMIR_DIR);
    const mcpConfigPath = path.join(mimirDir, "mcp.json");
    const readmePath = path.join(mimirDir, "README.md");
    await mkdir(targetDir, { recursive: true });
    await mkdir(mimirDir, { recursive: true });
    await cp(bundledSkillPath(PRIMARY_SKILL_NAME), skillPath, { recursive: true, force: true });
    await cp(bundledSkillPath(AUDIO_SKILL_NAME), audioSkillPath, { recursive: true, force: true });
    await writeFile(mcpConfigPath, `${JSON.stringify(mcpConfig(cwd), null, 2)}\n`, "utf8");
    await writeFile(readmePath, agentKitReadme(skillPath, audioSkillPath, mcpConfigPath), "utf8");
    const wroteGitignore = await ensureMimirGitignore(cwd);
    const written = [
        path.relative(cwd, skillPath),
        path.relative(cwd, audioSkillPath),
        path.relative(cwd, mcpConfigPath),
        path.relative(cwd, readmePath),
    ];
    if (wroteGitignore) {
        written.push(".gitignore");
    }
    return {
        skillPath,
        audioSkillPath,
        mcpConfigPath,
        readmePath,
        written,
    };
}
function mcpConfig(cwd) {
    return {
        mcpServers: {
            mimir: {
                command: "pnpm",
                args: ["exec", "kb", "serve-mcp"],
                cwd,
            },
        },
    };
}
function agentKitReadme(skillPath, audioSkillPath, mcpConfigPath) {
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
local Mimir state by default and prefers offline TTS engines for confidential content.

## MCP

MCP config example:

\`\`\`plain text
${mcpConfigPath}
\`\`\`

Use the MCP server when your agent supports MCP tools. The server command is:

\`\`\`bash
pnpm exec kb serve-mcp
\`\`\`

`;
}
//# sourceMappingURL=skill.js.map
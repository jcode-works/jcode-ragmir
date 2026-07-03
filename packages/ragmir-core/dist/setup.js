import path from "node:path";
import { loadConfig } from "./config.js";
import { doctor } from "./doctor.js";
import { pullEmbeddingModel } from "./embeddings.js";
import { ingest } from "./ingest.js";
import { initProject } from "./init.js";
import { ragmirCommand } from "./package-manager.js";
import { enableSemanticEmbeddings } from "./semantic-config.js";
import { installSkill } from "./skill.js";
export async function setupProject(options = {}) {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const created = await initProject(cwd);
    const installOptions = { cwd };
    if (options.targetDir !== undefined) {
        installOptions.targetDir = options.targetDir;
    }
    if (options.agents !== undefined) {
        installOptions.agents = options.agents;
    }
    if (options.mcpServerName !== undefined) {
        installOptions.mcpServerName = options.mcpServerName;
    }
    if (options.mcpCommand !== undefined) {
        installOptions.mcpCommand = options.mcpCommand;
    }
    if (options.mcpArgs !== undefined) {
        installOptions.mcpArgs = options.mcpArgs;
    }
    const agentKit = await installSkill(installOptions);
    const semantic = options.semantic ? await setupSemanticEmbeddings(cwd) : null;
    let report = await doctor(cwd);
    let ingested = null;
    if (options.ingest !== false && canAutoIngest(report)) {
        ingested = await ingest({ cwd });
        report = await doctor(cwd);
    }
    const command = await ragmirCommand(cwd, ["doctor"]);
    return {
        projectRoot: report.projectRoot,
        packageManager: command.packageManager,
        runCommand: command.display,
        created,
        agentKit,
        semantic,
        ingested,
        doctor: report,
        nextSteps: setupNextSteps(report),
    };
}
async function setupSemanticEmbeddings(cwd) {
    const config = await loadConfig(cwd);
    const model = await pullEmbeddingModel(config);
    const semanticConfig = await enableSemanticEmbeddings(cwd);
    return {
        model,
        config: semanticConfig,
    };
}
function canAutoIngest(report) {
    return (report.supportedFiles > 0 &&
        report.securityWarnings.length === 0 &&
        (report.chunksIndexed === 0 || report.missingFromIndex > 0 || report.staleInIndex > 0));
}
function setupNextSteps(report) {
    if (report.ready) {
        return [
            "Ask questions with the search or ask command shown by `ragmir doctor`.",
            "Run `ragmir install-agent --agents claude` or another targeted agent list for native skill discovery.",
            "Wire the matching MCP helper from .ragmir/ when the agent should call Ragmir tools directly.",
        ];
    }
    return report.nextSteps;
}
//# sourceMappingURL=setup.js.map
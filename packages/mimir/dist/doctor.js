import { existsSync } from "node:fs";
import path from "node:path";
import { findProjectRoot, loadConfig } from "./config.js";
import { CONFIG_PATH, MIMIR_DIR } from "./defaults.js";
import { audit } from "./ingest.js";
import { kbCommand } from "./package-manager.js";
import { securityAudit } from "./security.js";
import { countRows } from "./store.js";
export async function doctor(cwd = process.cwd()) {
    const projectRoot = findProjectRoot(cwd);
    const initialized = existsSync(path.join(projectRoot, CONFIG_PATH));
    const config = await loadConfig(cwd);
    const command = await kbCommand(projectRoot, []);
    const agentKitInstalled = isAgentKitInstalled(projectRoot);
    const [auditReport, securityReport, chunksIndexed] = await Promise.all([
        audit(projectRoot),
        securityAudit(projectRoot),
        countRows(config),
    ]);
    const nextSteps = nextActions({
        initialized,
        supportedFiles: auditReport.supportedFiles.length,
        chunksIndexed,
        missingFromIndex: auditReport.missingFromIndex.length,
        staleInIndex: auditReport.staleInIndex.length,
        warnings: securityReport.warnings.length,
        agentKitInstalled,
        run: (args) => command.display + (args.length > 0 ? ` ${args.join(" ")}` : ""),
    });
    return {
        projectRoot: config.projectRoot,
        initialized,
        packageManager: command.packageManager,
        runCommand: command.display,
        agentKitInstalled,
        rawDir: config.rawDir,
        storageDir: config.storageDir,
        embeddingProvider: config.embeddingProvider,
        transformersAllowRemoteModels: config.transformersAllowRemoteModels,
        redactionEnabled: config.redaction.enabled,
        accessLog: config.accessLog,
        supportedFiles: auditReport.supportedFiles.length,
        indexedFiles: auditReport.indexedFiles.length,
        chunksIndexed,
        missingFromIndex: auditReport.missingFromIndex.length,
        staleInIndex: auditReport.staleInIndex.length,
        securityWarnings: securityReport.warnings,
        ready: initialized &&
            chunksIndexed > 0 &&
            auditReport.missingFromIndex.length === 0 &&
            auditReport.staleInIndex.length === 0 &&
            securityReport.warnings.length === 0,
        nextSteps,
    };
}
function nextActions(input) {
    const steps = [];
    if (!input.initialized) {
        steps.push(`Run \`${input.run(["setup"])}\` to initialize Mimir and install the agent kit.`);
        return steps;
    }
    if (input.supportedFiles === 0) {
        steps.push("Add supported files under private/ or list extra source paths in .kb/sources.txt.");
        return steps;
    }
    if (input.chunksIndexed === 0 || input.missingFromIndex > 0 || input.staleInIndex > 0) {
        steps.push(`Run \`${input.run(["doctor", "--fix"])}\` to rebuild stale or missing index data.`);
        steps.push(`Run \`${input.run(["audit"])}\` to verify missingFromIndex=0 and staleInIndex=0.`);
    }
    if (input.warnings > 0) {
        steps.push(`Run \`${input.run(["security-audit", "--strict"])}\` and fix the reported warnings.`);
    }
    if (steps.length === 0) {
        steps.push(`Run \`${input.run(["search", '"your question"'])}\` to retrieve source passages.`);
        steps.push(`Run \`${input.run(["ask", '"your question"'])}\` to produce cited retrieval context.`);
        if (input.agentKitInstalled) {
            steps.push("Connect an AI with .mimir/mcp.json or load .mimir/skills/mimir/.");
        }
        else {
            steps.push(`Run \`${input.run(["install-skill"])}\` if an AI agent should use the local knowledge base.`);
        }
    }
    return steps;
}
function isAgentKitInstalled(projectRoot) {
    return (existsSync(path.join(projectRoot, MIMIR_DIR, "skills", "mimir", "SKILL.md")) &&
        existsSync(path.join(projectRoot, MIMIR_DIR, "skills", "mimir-audio-summary", "SKILL.md")) &&
        existsSync(path.join(projectRoot, MIMIR_DIR, "mcp.json")));
}
//# sourceMappingURL=doctor.js.map
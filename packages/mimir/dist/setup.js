import path from "node:path";
import { doctor } from "./doctor.js";
import { ingest } from "./ingest.js";
import { initProject } from "./init.js";
import { kbCommand } from "./package-manager.js";
import { installSkill } from "./skill.js";
export async function setupProject(options = {}) {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const created = await initProject(cwd);
    const installOptions = { cwd };
    if (options.targetDir !== undefined) {
        installOptions.targetDir = options.targetDir;
    }
    const agentKit = await installSkill(installOptions);
    let report = await doctor(cwd);
    let ingested = null;
    if (options.ingest !== false && canAutoIngest(report)) {
        ingested = await ingest({ cwd, rebuild: true });
        report = await doctor(cwd);
    }
    const command = await kbCommand(cwd, ["doctor"]);
    return {
        projectRoot: report.projectRoot,
        packageManager: command.packageManager,
        runCommand: command.display,
        created,
        agentKit,
        ingested,
        doctor: report,
        nextSteps: setupNextSteps(report),
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
            "Ask questions with the search or ask command shown by `kb doctor`.",
            "Connect an AI with .mimir/mcp.json or load .mimir/skills/mimir/.",
        ];
    }
    return report.nextSteps;
}
//# sourceMappingURL=setup.js.map
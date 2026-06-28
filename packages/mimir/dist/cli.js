#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { loadConfig } from "./config.js";
import { destroyIndex } from "./destroy.js";
import { audit, ingest } from "./ingest.js";
import { initProject } from "./init.js";
import { serveMcp } from "./mcp.js";
import { ask, search } from "./query.js";
import { securityAudit } from "./security.js";
import { bundledSkillPath, installSkill } from "./skill.js";
import { countRows } from "./store.js";
import { VERSION } from "./version.js";
const SEARCH_TEXT_PREVIEW_LENGTH = 900;
const TTS_PACKAGE_NAME = "@jcode.labs/mimir-tts";
const program = new Command();
program
    .name("kb")
    .description("Local-first RAG knowledge base for private project documents.")
    .version(VERSION);
program
    .command("init")
    .description("Create .kb config files and private/ document folder in the current repository.")
    .action(async () => {
    const created = await initProject(process.cwd());
    if (created.length === 0) {
        console.log(pc.green("Already initialized."));
        return;
    }
    console.log(pc.green("Created:"));
    for (const file of created) {
        console.log(`  - ${file}`);
    }
});
program
    .command("ingest")
    .description("Parse documents, create chunks, embed them locally, and rebuild the LanceDB index.")
    .option("--rebuild", "Accepted for compatibility; ingest always rebuilds the local index.")
    .action(async () => {
    const result = await ingest({ cwd: process.cwd(), rebuild: true });
    console.log(pc.green(`Done. indexedFiles=${result.indexedFiles} chunks=${result.chunks} skippedFiles=${result.skippedFiles} redactions=${result.redactions} errors=${result.errors.length}`));
    for (const error of result.errors) {
        console.error(pc.red(`  - ${error.path}: ${error.message}`));
    }
    if (result.errors.length > 0) {
        process.exitCode = 1;
    }
});
program
    .command("search")
    .description("Retrieve the most relevant passages without calling an LLM.")
    .argument("<query>", "Search query.")
    .option("-k, --top-k <number>", "Number of passages to return.", parsePositiveInt)
    .action(async (query, options) => {
    const results = await search(query, withTopK(options.topK));
    if (results.length === 0) {
        console.error(pc.yellow("No results. Run `kb ingest` first, or add documents."));
        process.exitCode = 1;
        return;
    }
    for (const [index, result] of results.entries()) {
        const distance = result.distance === null ? "n/a" : result.distance.toFixed(4);
        console.log(`\n${pc.cyan(`[${index + 1}] ${result.relativePath}`)} chunk=${result.chunkIndex} distance=${distance}`);
        console.log(result.text.slice(0, SEARCH_TEXT_PREVIEW_LENGTH));
    }
});
program
    .command("ask")
    .description("Return cited retrieval context for a question without calling an LLM.")
    .argument("<query>", "Question to answer.")
    .option("-k, --top-k <number>", "Number of passages to use.", parsePositiveInt)
    .action(async (query, options) => {
    const result = await ask(query, withTopK(options.topK));
    console.log(`\n${result.answer}\n`);
    if (result.sources.length > 0) {
        console.log(pc.dim("Sources:"));
        for (const [index, source] of result.sources.entries()) {
            console.log(`  [${index + 1}] ${source.relativePath} chunk=${source.chunkIndex}`);
        }
    }
});
program
    .command("audit")
    .description("Compare supported files on disk with the current vector index.")
    .action(async () => {
    const report = await audit(process.cwd());
    console.log(`supportedFiles=${report.supportedFiles.length}`);
    console.log(`indexedFiles=${report.indexedFiles.length}`);
    console.log(`totalChunks=${report.totalChunks}`);
    console.log(`missingFromIndex=${report.missingFromIndex.length}`);
    console.log(`staleInIndex=${report.staleInIndex.length}`);
    for (const file of report.missingFromIndex) {
        console.log(pc.yellow(`missing: ${file}`));
    }
    for (const file of report.staleInIndex) {
        console.log(pc.red(`stale: ${file}`));
    }
    if (report.missingFromIndex.length > 0 || report.staleInIndex.length > 0) {
        process.exitCode = 1;
    }
});
program
    .command("status")
    .description("Show active configuration and index row count.")
    .action(async () => {
    const config = await loadConfig(process.cwd());
    const rows = await countRows(config);
    console.log(`projectRoot=${config.projectRoot}`);
    console.log(`rawDir=${config.rawDir}`);
    console.log(`storageDir=${config.storageDir}`);
    console.log(`sourcesFile=${config.sourcesFile}`);
    console.log(`accessLogPath=${config.accessLogPath}`);
    console.log(`embeddingModelPath=${config.embeddingModelPath}`);
    console.log(`embeddingProvider=${config.embeddingProvider}`);
    console.log(`embeddingModel=${config.embeddingModel}`);
    console.log(`transformersAllowRemoteModels=${config.transformersAllowRemoteModels}`);
    console.log(`redactionEnabled=${config.redaction.enabled}`);
    console.log(`accessLog=${config.accessLog}`);
    console.log(`mcpMaxTopK=${config.mcpMaxTopK}`);
    console.log(`includeExtensions=${config.includeExtensions.join(",")}`);
    console.log(`chunksIndexed=${rows}`);
});
program
    .command("security-audit")
    .description("Show local privacy, provider, redaction, MCP, and gitignore posture.")
    .option("--json", "Print machine-readable JSON.")
    .option("--strict", "Exit with code 1 when warnings are present.")
    .action(async (options) => {
    const report = await securityAudit(process.cwd());
    if (options.json) {
        console.log(JSON.stringify(report, null, 2));
    }
    else {
        console.log(`zeroTelemetry=${report.zeroTelemetry}`);
        console.log(`embeddingProvider=${report.providers.embedding}`);
        console.log(`embeddingModel=${report.providers.embeddingModel}`);
        console.log(`embeddingModelPath=${report.providers.embeddingModelPath}`);
        console.log(`transformersAllowRemoteModels=${report.providers.transformersAllowRemoteModels}`);
        console.log(`llmGeneration=${report.providers.llmGeneration}`);
        console.log(`redactionEnabled=${report.redaction.enabled}`);
        console.log(`redactionBuiltIn=${report.redaction.builtIn}`);
        console.log(`accessLog=${report.accessLog.enabled}`);
        console.log(`accessLogStoresRawQueries=${report.accessLog.storesRawQueries}`);
        console.log(`storageGitIgnored=${report.storage.gitIgnored}`);
        console.log(`mcpMaxTopK=${report.mcp.maxTopK}`);
        console.log(`mcpDestructiveToolsExposed=${report.mcp.destructiveToolsExposed}`);
        for (const warning of report.warnings) {
            console.log(pc.yellow(`warning: ${warning}`));
        }
    }
    if (options.strict && report.warnings.length > 0) {
        process.exitCode = 1;
    }
});
program
    .command("destroy-index")
    .description("Remove the generated local vector index from .kb/storage.")
    .option("--yes", "Confirm deletion without an interactive prompt.")
    .action(async (options) => {
    if (!options.yes) {
        console.error(pc.red("Refusing to delete the index without --yes."));
        process.exitCode = 1;
        return;
    }
    const result = await destroyIndex(process.cwd());
    console.log(`storageDir=${result.storageDir}`);
    console.log(`removed=${result.removed}`);
    console.log(result.note);
});
program
    .command("audio")
    .description("Render a narration text file to local speech audio with Mimir TTS.")
    .argument("[text-file]", "Narration text file to render.")
    .option("-o, --out <path>", "Output WAV path.")
    .option("--model <id>", "Transformers.js TTS model ID.")
    .option("--model-path <path>", "Local model/cache path.")
    .option("--offline", "Disable remote model downloads.")
    .option("--allow-remote-models", "Explicitly allow remote model downloads.")
    .option("--speaker-embeddings <path>", "Optional model-specific speaker embedding path or URL.")
    .option("--speed <number>", "Optional model-specific speech speed.", parseNumber)
    .option("--doctor", "Show TTS runtime readiness instead of rendering.")
    .option("--json", "Print machine-readable JSON.")
    .action(async (textFile, options) => {
    const tts = await loadTts();
    if (options.doctor) {
        const report = await tts.doctor();
        printMaybeJson(report, options.json);
        return;
    }
    if (!textFile) {
        console.error(pc.red("Missing text file. Use `kb audio <text-file>`."));
        process.exitCode = 1;
        return;
    }
    const renderOptions = {
        cwd: process.cwd(),
        textFile,
    };
    addOption(renderOptions, "outputPath", options.out);
    addOption(renderOptions, "model", options.model);
    addOption(renderOptions, "modelPath", options.modelPath);
    addOption(renderOptions, "allowRemoteModels", audioAllowRemoteModels(options));
    addOption(renderOptions, "speakerEmbeddings", options.speakerEmbeddings);
    addOption(renderOptions, "speed", options.speed);
    const result = await tts.renderSpeech(renderOptions);
    printMaybeJson(result, options.json);
});
program
    .command("serve-mcp")
    .description("Start the MCP server over stdio for Claude, Codex, and other MCP-compatible agents.")
    .action(async () => {
    await serveMcp(process.cwd());
});
program
    .command("skill-path")
    .description("Print the bundled Mimir skill path for agents that can load SKILL.md folders.")
    .action(() => {
    console.log(bundledSkillPath());
});
program
    .command("install-skill")
    .description("Copy the bundled agent skill and MCP config snippet into the current repository.")
    .option("--target-dir <path>", "Directory where the skill folder should be copied.", ".mimir/skills")
    .action(async (options) => {
    const result = await installSkill({ cwd: process.cwd(), targetDir: options.targetDir });
    console.log("Installed Mimir agent kit:");
    for (const file of result.written) {
        console.log(`  - ${file}`);
    }
    console.log(`Skill path: ${result.skillPath}`);
    console.log(`Optional audio skill path: ${result.audioSkillPath}`);
    console.log(`MCP config example: ${result.mcpConfigPath}`);
});
await program.parseAsync(process.argv);
function parsePositiveInt(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error("Expected a positive integer.");
    }
    return parsed;
}
function parseNumber(value) {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) {
        throw new Error("Expected a number.");
    }
    return parsed;
}
function withTopK(topK) {
    return topK === undefined ? { cwd: process.cwd() } : { cwd: process.cwd(), topK };
}
async function loadTts() {
    const module = await import(TTS_PACKAGE_NAME);
    if (!isTtsModule(module)) {
        throw new Error(`${TTS_PACKAGE_NAME} did not expose the expected TTS API.`);
    }
    return module;
}
function isTtsModule(value) {
    return (typeof value === "object" &&
        value !== null &&
        "doctor" in value &&
        typeof value.doctor === "function" &&
        "renderSpeech" in value &&
        typeof value.renderSpeech === "function");
}
function audioAllowRemoteModels(options) {
    if (options.offline) {
        return false;
    }
    if (options.allowRemoteModels) {
        return true;
    }
    return undefined;
}
function printMaybeJson(value, json) {
    if (json) {
        console.log(JSON.stringify(value, null, 2));
        return;
    }
    if (typeof value === "object" && value !== null) {
        for (const [key, entry] of Object.entries(value)) {
            console.log(`${key}=${String(entry)}`);
        }
        return;
    }
    console.log(String(value));
}
function addOption(target, key, value) {
    if (value !== undefined) {
        target[key] = value;
    }
}
//# sourceMappingURL=cli.js.map
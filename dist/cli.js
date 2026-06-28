#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { audit, ingest } from "./ingest.js";
import { initProject } from "./init.js";
import { ask, search } from "./query.js";
import { countRows } from "./store.js";
import { loadConfig } from "./config.js";
const program = new Command();
program
    .name("kb")
    .description("Local-first RAG knowledge base for private project documents.")
    .version("0.1.0");
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
    console.log(pc.green(`Done. indexedFiles=${result.indexedFiles} chunks=${result.chunks} skippedFiles=${result.skippedFiles} errors=${result.errors.length}`));
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
        console.log(result.text.slice(0, 900));
    }
});
program
    .command("ask")
    .description("Answer a question using retrieved passages and a local Ollama model.")
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
    console.log(`embedModel=${config.embedModel}`);
    console.log(`llmModel=${config.llmModel}`);
    console.log(`chunksIndexed=${rows}`);
});
await program.parseAsync(process.argv);
function parsePositiveInt(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error("Expected a positive integer.");
    }
    return parsed;
}
function withTopK(topK) {
    return topK === undefined ? { cwd: process.cwd() } : { cwd: process.cwd(), topK };
}
//# sourceMappingURL=cli.js.map
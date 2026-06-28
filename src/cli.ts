#!/usr/bin/env node
import { Command } from "commander"
import pc from "picocolors"
import { loadConfig } from "./config.js"
import { destroyIndex } from "./destroy.js"
import { audit, ingest } from "./ingest.js"
import { initProject } from "./init.js"
import { serveMcp } from "./mcp.js"
import { ask, search } from "./query.js"
import { securityAudit } from "./security.js"
import { bundledSkillPath, installSkill } from "./skill.js"
import { countRows } from "./store.js"
import { VERSION } from "./version.js"

const program = new Command()

program
  .name("kb")
  .description("Local-first RAG knowledge base for private project documents.")
  .version(VERSION)

program
  .command("init")
  .description("Create .kb config files and private/ document folder in the current repository.")
  .action(async () => {
    const created = await initProject(process.cwd())
    if (created.length === 0) {
      console.log(pc.green("Already initialized."))
      return
    }
    console.log(pc.green("Created:"))
    for (const file of created) {
      console.log(`  - ${file}`)
    }
  })

program
  .command("ingest")
  .description("Parse documents, create chunks, embed them locally, and rebuild the LanceDB index.")
  .option("--rebuild", "Accepted for compatibility; ingest always rebuilds the local index.")
  .action(async () => {
    const result = await ingest({ cwd: process.cwd(), rebuild: true })
    console.log(
      pc.green(
        `Done. indexedFiles=${result.indexedFiles} chunks=${result.chunks} skippedFiles=${result.skippedFiles} redactions=${result.redactions} errors=${result.errors.length}`,
      ),
    )
    for (const error of result.errors) {
      console.error(pc.red(`  - ${error.path}: ${error.message}`))
    }
    if (result.errors.length > 0) {
      process.exitCode = 1
    }
  })

program
  .command("search")
  .description("Retrieve the most relevant passages without calling an LLM.")
  .argument("<query>", "Search query.")
  .option("-k, --top-k <number>", "Number of passages to return.", parsePositiveInt)
  .action(async (query: string, options: { topK?: number }) => {
    const results = await search(query, withTopK(options.topK))
    if (results.length === 0) {
      console.error(pc.yellow("No results. Run `kb ingest` first, or add documents."))
      process.exitCode = 1
      return
    }

    for (const [index, result] of results.entries()) {
      const distance = result.distance === null ? "n/a" : result.distance.toFixed(4)
      console.log(
        `\n${pc.cyan(`[${index + 1}] ${result.relativePath}`)} chunk=${result.chunkIndex} distance=${distance}`,
      )
      console.log(result.text.slice(0, 900))
    }
  })

program
  .command("ask")
  .description("Answer a question using retrieved passages and a local Ollama model.")
  .argument("<query>", "Question to answer.")
  .option("-k, --top-k <number>", "Number of passages to use.", parsePositiveInt)
  .action(async (query: string, options: { topK?: number }) => {
    const result = await ask(query, withTopK(options.topK))
    console.log(`\n${result.answer}\n`)
    if (result.sources.length > 0) {
      console.log(pc.dim("Sources:"))
      for (const [index, source] of result.sources.entries()) {
        console.log(`  [${index + 1}] ${source.relativePath} chunk=${source.chunkIndex}`)
      }
    }
  })

program
  .command("audit")
  .description("Compare supported files on disk with the current vector index.")
  .action(async () => {
    const report = await audit(process.cwd())
    console.log(`supportedFiles=${report.supportedFiles.length}`)
    console.log(`indexedFiles=${report.indexedFiles.length}`)
    console.log(`totalChunks=${report.totalChunks}`)
    console.log(`missingFromIndex=${report.missingFromIndex.length}`)
    console.log(`staleInIndex=${report.staleInIndex.length}`)

    for (const file of report.missingFromIndex) {
      console.log(pc.yellow(`missing: ${file}`))
    }
    for (const file of report.staleInIndex) {
      console.log(pc.red(`stale: ${file}`))
    }

    if (report.missingFromIndex.length > 0 || report.staleInIndex.length > 0) {
      process.exitCode = 1
    }
  })

program
  .command("status")
  .description("Show active configuration and index row count.")
  .action(async () => {
    const config = await loadConfig(process.cwd())
    const rows = await countRows(config)
    console.log(`projectRoot=${config.projectRoot}`)
    console.log(`rawDir=${config.rawDir}`)
    console.log(`storageDir=${config.storageDir}`)
    console.log(`sourcesFile=${config.sourcesFile}`)
    console.log(`accessLogPath=${config.accessLogPath}`)
    console.log(`networkPolicy=${config.networkPolicy}`)
    console.log(`embedModel=${config.embedModel}`)
    console.log(`llmModel=${config.llmModel}`)
    console.log(`redactionEnabled=${config.redaction.enabled}`)
    console.log(`accessLog=${config.accessLog}`)
    console.log(`mcpMaxTopK=${config.mcpMaxTopK}`)
    console.log(`chunksIndexed=${rows}`)
  })

program
  .command("security-audit")
  .description("Show local privacy, network, redaction, MCP, and gitignore posture.")
  .option("--json", "Print machine-readable JSON.")
  .option("--strict", "Exit with code 1 when warnings are present.")
  .action(async (options: { json?: boolean; strict?: boolean }) => {
    const report = await securityAudit(process.cwd())
    if (options.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log(`zeroTelemetry=${report.zeroTelemetry}`)
      console.log(`networkPolicy=${report.network.policy}`)
      console.log(`ollamaHost=${report.network.ollamaHost}`)
      console.log(`ollamaHostClassification=${report.network.classification}`)
      console.log(`redactionEnabled=${report.redaction.enabled}`)
      console.log(`redactionBuiltIn=${report.redaction.builtIn}`)
      console.log(`accessLog=${report.accessLog.enabled}`)
      console.log(`accessLogStoresRawQueries=${report.accessLog.storesRawQueries}`)
      console.log(`storageGitIgnored=${report.storage.gitIgnored}`)
      console.log(`mcpMaxTopK=${report.mcp.maxTopK}`)
      console.log(`mcpDestructiveToolsExposed=${report.mcp.destructiveToolsExposed}`)
      for (const warning of report.warnings) {
        console.log(pc.yellow(`warning: ${warning}`))
      }
    }
    if (options.strict && report.warnings.length > 0) {
      process.exitCode = 1
    }
  })

program
  .command("destroy-index")
  .description("Remove the generated local vector index from .kb/storage.")
  .option("--yes", "Confirm deletion without an interactive prompt.")
  .action(async (options: { yes?: boolean }) => {
    if (!options.yes) {
      console.error(pc.red("Refusing to delete the index without --yes."))
      process.exitCode = 1
      return
    }

    const result = await destroyIndex(process.cwd())
    console.log(`storageDir=${result.storageDir}`)
    console.log(`removed=${result.removed}`)
    console.log(result.note)
  })

program
  .command("serve-mcp")
  .description(
    "Start the MCP server over stdio for Claude, Codex, and other MCP-compatible agents.",
  )
  .action(async () => {
    await serveMcp(process.cwd())
  })

program
  .command("skill-path")
  .description("Print the bundled Mimir skill path for agents that can load SKILL.md folders.")
  .action(() => {
    console.log(bundledSkillPath())
  })

program
  .command("install-skill")
  .description("Copy the bundled agent skill and MCP config snippet into the current repository.")
  .option(
    "--target-dir <path>",
    "Directory where the skill folder should be copied.",
    ".mimir/skills",
  )
  .action(async (options: { targetDir: string }) => {
    const result = await installSkill({ cwd: process.cwd(), targetDir: options.targetDir })
    console.log("Installed Mimir agent kit:")
    for (const file of result.written) {
      console.log(`  - ${file}`)
    }
    console.log(`Skill path: ${result.skillPath}`)
    console.log(`MCP config example: ${result.mcpConfigPath}`)
  })

await program.parseAsync(process.argv)

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Expected a positive integer.")
  }
  return parsed
}

function withTopK(topK: number | undefined): { cwd: string; topK?: number } {
  return topK === undefined ? { cwd: process.cwd() } : { cwd: process.cwd(), topK }
}

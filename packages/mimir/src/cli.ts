#!/usr/bin/env node
import { Command } from "commander"
import pc from "picocolors"
import { loadConfig } from "./config.js"
import { destroyIndex } from "./destroy.js"
import { doctor } from "./doctor.js"
import { audit, ingest } from "./ingest.js"
import { initProject } from "./init.js"
import { serveMcp } from "./mcp.js"
import { kbCommand } from "./package-manager.js"
import { ask, search } from "./query.js"
import { securityAudit } from "./security.js"
import { setupProject } from "./setup.js"
import { bundledSkillPath, installSkill } from "./skill.js"
import { countRows } from "./store.js"
import { VERSION } from "./version.js"

const SEARCH_TEXT_PREVIEW_LENGTH = 900
const TTS_PACKAGE_NAME = "@jcode.labs/mimir-tts"

const program = new Command()

program
  .name("kb")
  .description("Local-first RAG knowledge base for private project documents.")
  .version(VERSION)

program
  .command("doctor")
  .description("Diagnose setup, index freshness, privacy posture, and next steps.")
  .option("--fix", "Create missing scaffolding, install the agent kit, and rebuild stale indexes.")
  .option("--json", "Print machine-readable JSON.")
  .action(async (options: { fix?: boolean; json?: boolean }) => {
    if (options.fix) {
      const result = await setupProject({ cwd: process.cwd() })
      if (options.json) {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      printSetup(result, "Mimir repair complete.")
      return
    }

    const report = await doctor(process.cwd())
    if (options.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }

    printDoctor(report)
  })

program
  .command("setup")
  .description("Initialize Mimir, install the agent kit, run doctor, and ingest when safe.")
  .option(
    "--target-dir <path>",
    "Directory where the skill folder should be copied.",
    ".mimir/skills",
  )
  .option("--no-ingest", "Skip automatic indexing even when supported files are present.")
  .option("--json", "Print machine-readable JSON.")
  .action(async (options: { targetDir: string; ingest?: boolean; json?: boolean }) => {
    const setupOptions: Parameters<typeof setupProject>[0] = {
      cwd: process.cwd(),
      targetDir: options.targetDir,
    }
    addOption(setupOptions, "ingest", options.ingest)
    const result = await setupProject(setupOptions)
    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    printSetup(result, "Mimir setup complete.")
  })

program
  .command("init")
  .description("Create .kb config files and private/ document folder in the current repository.")
  .action(async () => {
    const created = await initProject(process.cwd())
    if (created.length === 0) {
      console.log(pc.green("Already initialized."))
      const doctorCommand = await kbCommand(process.cwd(), ["doctor"])
      console.log(`Run \`${doctorCommand.display}\` to check readiness.`)
      return
    }
    console.log(pc.green("Created:"))
    for (const file of created) {
      console.log(`  - ${file}`)
    }
    const ingestCommand = await kbCommand(process.cwd(), ["ingest"])
    const doctorCommand = await kbCommand(process.cwd(), ["doctor"])
    const searchCommand = await kbCommand(process.cwd(), ["search", "your question"])
    console.log("")
    console.log(pc.cyan("Next steps:"))
    console.log("  1. Add supported documents under private/")
    console.log(`  2. Run \`${ingestCommand.display}\``)
    console.log(`  3. Run \`${doctorCommand.display}\``)
    console.log(`  4. Query with \`${searchCommand.display}\``)
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
      const repairCommand = await kbCommand(process.cwd(), ["doctor", "--fix"])
      console.error(pc.yellow(`No results. Add documents or run \`${repairCommand.display}\`.`))
      process.exitCode = 1
      return
    }

    for (const [index, result] of results.entries()) {
      const distance = result.distance === null ? "n/a" : result.distance.toFixed(4)
      console.log(
        `\n${pc.cyan(`[${index + 1}] ${result.relativePath}`)} chunk=${result.chunkIndex} distance=${distance}`,
      )
      console.log(result.text.slice(0, SEARCH_TEXT_PREVIEW_LENGTH))
    }
  })

program
  .command("ask")
  .description("Return cited retrieval context for a question without calling an LLM.")
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
    console.log(`embeddingModelPath=${config.embeddingModelPath}`)
    console.log(`embeddingProvider=${config.embeddingProvider}`)
    console.log(`embeddingModel=${config.embeddingModel}`)
    console.log(`transformersAllowRemoteModels=${config.transformersAllowRemoteModels}`)
    console.log(`redactionEnabled=${config.redaction.enabled}`)
    console.log(`accessLog=${config.accessLog}`)
    console.log(`mcpMaxTopK=${config.mcpMaxTopK}`)
    console.log(`includeExtensions=${config.includeExtensions.join(",")}`)
    console.log(`chunksIndexed=${rows}`)
  })

program
  .command("security-audit")
  .description("Show local privacy, provider, redaction, MCP, and gitignore posture.")
  .option("--json", "Print machine-readable JSON.")
  .option("--strict", "Exit with code 1 when warnings are present.")
  .action(async (options: { json?: boolean; strict?: boolean }) => {
    const report = await securityAudit(process.cwd())
    if (options.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log(`zeroTelemetry=${report.zeroTelemetry}`)
      console.log(`embeddingProvider=${report.providers.embedding}`)
      console.log(`embeddingModel=${report.providers.embeddingModel}`)
      console.log(`embeddingModelPath=${report.providers.embeddingModelPath}`)
      console.log(`transformersAllowRemoteModels=${report.providers.transformersAllowRemoteModels}`)
      console.log(`llmGeneration=${report.providers.llmGeneration}`)
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
  .command("audio")
  .description("Render a narration text file to local speech audio with Mimir TTS.")
  .argument("[text-file]", "Narration text file to render.")
  .option("-o, --out <path>", "Output MP3 or WAV path.")
  .option("--engine <engine>", "TTS engine: auto, edge, or transformers.")
  .option("--model <id>", "Transformers.js TTS model ID.")
  .option("--model-path <path>", "Local model/cache path.")
  .option("--offline", "Force the Transformers.js local/offline WAV path.")
  .option("--allow-remote-models", "Explicitly allow remote model downloads.")
  .option("--voice <voice>", "Edge voice. Defaults to fr-FR-DeniseNeural.")
  .option("--rate <rate>", "Edge rate. Defaults to +0%.")
  .option("--speaker-embeddings <path>", "Optional model-specific speaker embedding path or URL.")
  .option("--speed <number>", "Optional model-specific speech speed.", parseNumber)
  .option("--doctor", "Show TTS runtime readiness instead of rendering.")
  .option("--json", "Print machine-readable JSON.")
  .action(async (textFile: string | undefined, options: AudioOptions) => {
    const tts = await loadTts()

    if (options.doctor) {
      const report = await tts.doctor()
      printMaybeJson(report, options.json)
      return
    }

    if (!textFile) {
      console.error(pc.red("Missing text file. Use `kb audio <text-file>`."))
      process.exitCode = 1
      return
    }

    const renderOptions: TtsRenderOptions = {
      cwd: process.cwd(),
      textFile,
      engine: audioEngine(options),
    }
    addOption(renderOptions, "outputPath", options.out)
    addOption(renderOptions, "model", options.model)
    addOption(renderOptions, "modelPath", options.modelPath)
    addOption(renderOptions, "allowRemoteModels", audioAllowRemoteModels(options))
    addOption(renderOptions, "voice", options.voice)
    addOption(renderOptions, "rate", options.rate)
    addOption(renderOptions, "speakerEmbeddings", options.speakerEmbeddings)
    addOption(renderOptions, "speed", options.speed)

    const result = await tts.renderSpeech(renderOptions)
    printMaybeJson(result, options.json)
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
    const doctorCommand = await kbCommand(process.cwd(), ["doctor"])
    console.log("Installed Mimir agent kit:")
    for (const file of result.written) {
      console.log(`  - ${file}`)
    }
    console.log(`Skill path: ${result.skillPath}`)
    console.log(`Optional audio skill path: ${result.audioSkillPath}`)
    console.log(`MCP config example: ${result.mcpConfigPath}`)
    console.log("")
    console.log("Next steps:")
    console.log("  1. Add the MCP config from .mimir/mcp.json to your agent if it supports MCP.")
    console.log("  2. Load .mimir/skills/mimir/ in agents that support skill folders.")
    console.log(`  3. Run \`${doctorCommand.display}\` before relying on retrieved context.`)
  })

try {
  await program.parseAsync(process.argv)
} catch (error) {
  console.error(pc.red(error instanceof Error ? error.message : String(error)))
  process.exitCode = 1
}

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Expected a positive integer.")
  }
  return parsed
}

function parseNumber(value: string): number {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) {
    throw new Error("Expected a number.")
  }
  return parsed
}

function withTopK(topK: number | undefined): { cwd: string; topK?: number } {
  return topK === undefined ? { cwd: process.cwd() } : { cwd: process.cwd(), topK }
}

interface AudioOptions {
  out?: string
  engine?: string
  model?: string
  modelPath?: string
  offline?: boolean
  allowRemoteModels?: boolean
  voice?: string
  rate?: string
  speakerEmbeddings?: string
  speed?: number
  doctor?: boolean
  json?: boolean
}

interface TtsModule {
  doctor: () => Promise<unknown>
  renderSpeech: (options: TtsRenderOptions) => Promise<unknown>
}

interface TtsRenderOptions {
  cwd: string
  textFile: string
  outputPath?: string
  engine: "auto" | "edge" | "transformers"
  model?: string
  modelPath?: string
  allowRemoteModels?: boolean
  voice?: string
  rate?: string
  speakerEmbeddings?: string
  speed?: number
}

async function loadTts(): Promise<TtsModule> {
  const module: unknown = await import(TTS_PACKAGE_NAME)
  if (!isTtsModule(module)) {
    throw new Error(`${TTS_PACKAGE_NAME} did not expose the expected TTS API.`)
  }
  return module
}

function isTtsModule(value: unknown): value is TtsModule {
  return (
    typeof value === "object" &&
    value !== null &&
    "doctor" in value &&
    typeof value.doctor === "function" &&
    "renderSpeech" in value &&
    typeof value.renderSpeech === "function"
  )
}

function audioAllowRemoteModels(options: AudioOptions): boolean | undefined {
  if (options.offline) {
    return false
  }
  if (options.allowRemoteModels) {
    return true
  }
  return undefined
}

function audioEngine(options: AudioOptions): TtsRenderOptions["engine"] {
  if (options.offline) {
    return "transformers"
  }
  if (options.engine === undefined) {
    if (options.out?.toLowerCase().endsWith(".mp3")) {
      throw new Error(
        "MP3 output uses online Edge TTS. Re-run with `--engine edge` only when sending narration text to Edge TTS is acceptable.",
      )
    }
    return "transformers"
  }
  if (options.engine === "auto" || options.engine === "edge" || options.engine === "transformers") {
    return options.engine
  }
  throw new Error("Expected --engine to be auto, edge, or transformers.")
}

function printDoctor(report: Awaited<ReturnType<typeof doctor>>): void {
  console.log(`projectRoot=${report.projectRoot}`)
  console.log(`initialized=${report.initialized}`)
  console.log(`ready=${report.ready}`)
  console.log(`packageManager=${report.packageManager}`)
  console.log(`runCommand=${report.runCommand}`)
  console.log(`agentKitInstalled=${report.agentKitInstalled}`)
  console.log(`embeddingProvider=${report.embeddingProvider}`)
  console.log(`transformersAllowRemoteModels=${report.transformersAllowRemoteModels}`)
  console.log(`redactionEnabled=${report.redactionEnabled}`)
  console.log(`accessLog=${report.accessLog}`)
  console.log(`supportedFiles=${report.supportedFiles}`)
  console.log(`indexedFiles=${report.indexedFiles}`)
  console.log(`chunksIndexed=${report.chunksIndexed}`)
  console.log(`missingFromIndex=${report.missingFromIndex}`)
  console.log(`staleInIndex=${report.staleInIndex}`)
  console.log(`securityWarnings=${report.securityWarnings.length}`)
  if (report.securityWarnings.length > 0) {
    for (const warning of report.securityWarnings) {
      console.log(pc.yellow(`warning: ${warning}`))
    }
  }
  console.log("nextSteps:")
  for (const step of report.nextSteps) {
    console.log(`  - ${step}`)
  }
}

function printSetup(result: Awaited<ReturnType<typeof setupProject>>, title: string): void {
  console.log(pc.green(title))
  console.log(`projectRoot=${result.projectRoot}`)
  console.log(`packageManager=${result.packageManager}`)
  console.log(`runCommand=${result.runCommand}`)
  console.log("")
  console.log(pc.cyan("Scaffolding:"))
  if (result.created.length === 0) {
    console.log("  - already initialized")
  } else {
    for (const file of result.created) {
      console.log(`  - ${file}`)
    }
  }
  console.log("")
  console.log(pc.cyan("Agent integration:"))
  console.log(`  - skill: ${result.agentKit.skillPath}`)
  console.log(`  - audio skill: ${result.agentKit.audioSkillPath}`)
  console.log(`  - MCP config: ${result.agentKit.mcpConfigPath}`)
  console.log("")
  console.log(pc.cyan("Index:"))
  if (result.ingested) {
    console.log(
      `  - ingested indexedFiles=${result.ingested.indexedFiles} chunks=${result.ingested.chunks} errors=${result.ingested.errors.length}`,
    )
  } else {
    console.log("  - skipped; add supported files or run doctor --fix when ready")
  }
  console.log("")
  printDoctor(result.doctor)
}

function printMaybeJson(value: unknown, json: boolean | undefined): void {
  if (json) {
    console.log(JSON.stringify(value, null, 2))
    return
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      console.log(`${key}=${String(entry)}`)
    }
    return
  }
  console.log(String(value))
}

function addOption<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value !== undefined) {
    target[key] = value
  }
}

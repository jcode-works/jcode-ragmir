#!/usr/bin/env node
import path from "node:path"
import { Command } from "commander"
import pc from "picocolors"
import { accessLogUsageReport } from "./access-log.js"
import { loadConfig } from "./config.js"
import { destroyIndex } from "./destroy.js"
import { doctor } from "./doctor.js"
import { pullEmbeddingModel } from "./embeddings.js"
import { evaluateGoldenQueries } from "./evaluate.js"
import { audit, ingest } from "./ingest.js"
import { initProject } from "./init.js"
import { serveMcp } from "./mcp.js"
import { mimirCommand } from "./package-manager.js"
import { ask, search } from "./query.js"
import { compactResearchReport, compactSearchResults, research } from "./research.js"
import { securityAudit } from "./security.js"
import { enableSemanticEmbeddings } from "./semantic-config.js"
import { setupProject } from "./setup.js"
import {
  type AgentInstallMode,
  type AgentInstallScope,
  bundledSkillPath,
  installAgentSkills,
  installSkill,
  parseAgentTargets,
  SUPPORTED_AGENT_TARGETS,
} from "./skill.js"
import { countRows } from "./store.js"
import type { ResearchReport } from "./types.js"
import { VERSION } from "./version.js"

const SEARCH_TEXT_PREVIEW_LENGTH = 900
const TTS_PACKAGE_NAME = "@jcode.labs/mimir-tts"

const program = new Command()

program
  .name("mimir")
  .description("Local-first RAG knowledge base for private project documents.")
  .version(VERSION)
  .option("--project-root <path>", "Run project-scoped commands against this local workspace.")

const modelsCommand = program.command("models").description("Manage local embedding models.")

modelsCommand
  .command("pull")
  .description("Download the configured Transformers.js embedding model into embeddingModelPath.")
  .option("--enable", "Switch Mimir config to Transformers embeddings after the model is ready.")
  .option("--json", "Print machine-readable JSON.")
  .action(async (options: { enable?: boolean; json?: boolean }, command: Command) => {
    const cwd = projectRoot(command)
    const config = await loadConfig(cwd)
    const result = await pullEmbeddingModel(config)
    const semanticConfig = options.enable ? await enableSemanticEmbeddings(cwd) : null
    if (options.json) {
      console.log(JSON.stringify(semanticConfig ? { ...result, semanticConfig } : result, null, 2))
      return
    }

    console.log(pc.green("Embedding model ready."))
    console.log(`embeddingModel=${result.embeddingModel}`)
    console.log(`embeddingModelPath=${result.embeddingModelPath}`)
    if (semanticConfig) {
      console.log(`semanticConfig=${semanticConfig.configPath}`)
      console.log(`embeddingProvider=${semanticConfig.embeddingProvider}`)
      console.log(`transformersAllowRemoteModels=${semanticConfig.transformersAllowRemoteModels}`)
    }
    console.log("")
    console.log("Next steps:")
    if (semanticConfig) {
      console.log("  1. Run `mimir ingest --rebuild` so existing vectors use the semantic model.")
      console.log("  2. Run `mimir doctor` to confirm readiness.")
    } else {
      console.log("  1. Re-run `mimir models pull --enable` to switch Mimir config safely.")
      console.log("  2. Run `mimir ingest --rebuild` so existing vectors use the semantic model.")
    }
  })

program
  .command("doctor")
  .description("Diagnose setup, index freshness, privacy posture, and next steps.")
  .option("--fix", "Create missing scaffolding, install the agent kit, and rebuild stale indexes.")
  .option("--json", "Print machine-readable JSON.")
  .action(async (options: { fix?: boolean; json?: boolean }, command: Command) => {
    const cwd = projectRoot(command)
    if (options.fix) {
      const result = await setupProject({ cwd })
      if (options.json) {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      printSetup(result, "Mimir repair complete.")
      return
    }

    const report = await doctor(cwd)
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
  .action(
    async (options: { targetDir: string; ingest?: boolean; json?: boolean }, command: Command) => {
      const cwd = projectRoot(command)
      const setupOptions: Parameters<typeof setupProject>[0] = {
        cwd,
        targetDir: options.targetDir,
      }
      addOption(setupOptions, "ingest", options.ingest)
      const result = await setupProject(setupOptions)
      if (options.json) {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      printSetup(result, "Mimir setup complete.")
    },
  )

program
  .command("init")
  .description("Create local .mimir config, raw-document folder, and gitignore rules.")
  .action(async (_options: unknown, command: Command) => {
    const cwd = projectRoot(command)
    const created = await initProject(cwd)
    if (created.length === 0) {
      console.log(pc.green("Already initialized."))
      const doctorCommand = await mimirCommand(cwd, ["doctor"])
      console.log(`Run \`${doctorCommand.display}\` to check readiness.`)
      return
    }
    console.log(pc.green("Created:"))
    for (const file of created) {
      console.log(`  - ${file}`)
    }
    const ingestCommand = await mimirCommand(cwd, ["ingest"])
    const doctorCommand = await mimirCommand(cwd, ["doctor"])
    const searchCommand = await mimirCommand(cwd, ["search", "your question"])
    console.log("")
    console.log(pc.cyan("Next steps:"))
    console.log("  1. Add supported documents under .mimir/raw/")
    console.log(`  2. Run \`${ingestCommand.display}\``)
    console.log(`  3. Run \`${doctorCommand.display}\``)
    console.log(`  4. Query with \`${searchCommand.display}\``)
  })

program
  .command("ingest")
  .description("Parse changed documents, redact, chunk, embed locally, and update LanceDB.")
  .option("--rebuild", "Force a full local index rebuild instead of reusing unchanged rows.")
  .option("--json", "Print machine-readable JSON.")
  .action(async (options: { rebuild?: boolean; json?: boolean }, command: Command) => {
    const cwd = projectRoot(command)
    const ingestOptions: Parameters<typeof ingest>[0] = { cwd }
    addOption(ingestOptions, "rebuild", options.rebuild)
    const result = await ingest(ingestOptions)
    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
      if (result.errors.length > 0) {
        process.exitCode = 1
      }
      return
    }

    console.log(
      pc.green(
        `Done. discoveredFiles=${result.discoveredFiles} supportedFiles=${result.supportedFiles} indexedFiles=${result.indexedFiles} rebuiltFiles=${result.rebuiltFiles} reusedFiles=${result.reusedFiles} chunks=${result.chunks} skippedFiles=${result.skippedFiles} unsupportedFiles=${result.unsupportedFiles} oversizedFiles=${result.oversizedFiles} sensitiveFiles=${result.sensitiveFiles} emptyTextFiles=${result.emptyTextFiles.length} redactions=${result.redactions} errors=${result.errors.length}`,
      ),
    )
    printUnsupportedSummary(result.unsupportedExtensions)
    printEmptyTextFiles(result.emptyTextFiles)
    if (result.unsupportedFiles > 0 || result.oversizedFiles > 0 || result.sensitiveFiles > 0) {
      const auditCommand = await mimirCommand(cwd, ["audit", "--unsupported"])
      console.log(
        pc.yellow(`Some files were not indexed. Run \`${auditCommand.display}\` for details.`),
      )
    }
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
  .option("--compact", "Return short snippets instead of full passages.")
  .option("--json", "Print machine-readable JSON.")
  .action(
    async (
      query: string,
      options: { topK?: number; compact?: boolean; json?: boolean },
      command: Command,
    ) => {
      const cwd = projectRoot(command)
      const results = await search(query, withTopK(cwd, options.topK))
      const outputResults = options.compact ? compactSearchResults(results) : results
      if (options.json) {
        console.log(JSON.stringify({ query, results: outputResults }, null, 2))
        if (results.length === 0) {
          process.exitCode = 1
        }
        return
      }

      if (results.length === 0) {
        const repairCommand = await mimirCommand(cwd, ["doctor", "--fix"])
        console.error(pc.yellow(`No results. Add documents or run \`${repairCommand.display}\`.`))
        process.exitCode = 1
        return
      }

      for (const [index, result] of outputResults.entries()) {
        const distance = result.distance === null ? "n/a" : result.distance.toFixed(4)
        console.log(
          `\n${pc.cyan(`[${index + 1}] ${result.relativePath}`)} chunk=${result.chunkIndex} distance=${distance}`,
        )
        console.log(
          "snippet" in result ? result.snippet : result.text.slice(0, SEARCH_TEXT_PREVIEW_LENGTH),
        )
      }
    },
  )

program
  .command("ask")
  .description("Return cited retrieval context for a question without calling an LLM.")
  .argument("<query>", "Question to answer.")
  .option("-k, --top-k <number>", "Number of passages to use.", parsePositiveInt)
  .option("--json", "Print machine-readable JSON.")
  .action(async (query: string, options: { topK?: number; json?: boolean }, command: Command) => {
    const cwd = projectRoot(command)
    const result = await ask(query, withTopK(cwd, options.topK))
    if (options.json) {
      console.log(JSON.stringify({ query, ...result }, null, 2))
      if (result.sources.length === 0) {
        process.exitCode = 1
      }
      return
    }

    console.log(`\n${result.answer}\n`)
    if (result.sources.length > 0) {
      console.log(pc.dim("Sources:"))
      for (const [index, source] of result.sources.entries()) {
        console.log(`  [${index + 1}] ${source.relativePath} chunk=${source.chunkIndex}`)
      }
    }
  })

program
  .command("research")
  .description("Run an audit-backed multi-query research pass with cited evidence.")
  .argument("<query>", "Research question or topic.")
  .option("-k, --top-k <number>", "Maximum number of evidence passages to keep.", parsePositiveInt)
  .option("--no-code", "Skip the lightweight repository code search.")
  .option("--compact", "Return snippets instead of full retrieved passages.")
  .option("--json", "Print machine-readable JSON.")
  .action(
    async (
      query: string,
      options: { topK?: number; code?: boolean; compact?: boolean; json?: boolean },
      command: Command,
    ) => {
      const cwd = projectRoot(command)
      const researchOptions: Parameters<typeof research>[1] = { cwd }
      addOption(researchOptions, "topK", options.topK)
      addOption(researchOptions, "includeCode", options.code)
      const report = await research(query, researchOptions)
      const output = options.compact ? compactResearchReport(report) : report
      if (options.json) {
        console.log(JSON.stringify(output, null, 2))
        if (!report.ready) {
          process.exitCode = 1
        }
        return
      }

      printResearchReport(output)
      if (!report.ready) {
        process.exitCode = 1
      }
    },
  )

program
  .command("evaluate")
  .description("Measure retrieval recall against a JSON golden query file.")
  .requiredOption("--golden <path>", "JSON file with queries and expected relative source paths.")
  .option(
    "-k, --top-k <number>",
    "Default number of passages to evaluate per query.",
    parsePositiveInt,
  )
  .option(
    "--fail-under <recall>",
    "Exit non-zero only when recall is below this threshold from 0 to 1.",
    parseRecallThreshold,
  )
  .option("--json", "Print machine-readable JSON.")
  .action(
    async (
      options: { golden: string; topK?: number; failUnder?: number; json?: boolean },
      command: Command,
    ) => {
      const cwd = projectRoot(command)
      const evaluationOptions: Parameters<typeof evaluateGoldenQueries>[0] = {
        cwd,
        goldenPath: options.golden,
      }
      addOption(evaluationOptions, "topK", options.topK)
      const result = await evaluateGoldenQueries(evaluationOptions)
      const minimumRecall = options.failUnder ?? 1
      const passed = result.recall >= minimumRecall
      if (options.json) {
        const payload =
          options.failUnder === undefined ? result : { ...result, minimumRecall, passed }
        console.log(JSON.stringify(payload, null, 2))
        if (!passed) {
          process.exitCode = 1
        }
        return
      }

      const thresholdSummary =
        options.failUnder === undefined
          ? ""
          : ` minimumRecall=${minimumRecall.toFixed(3)} passed=${passed}`
      console.log(
        `golden=${result.goldenPath} total=${result.total} hits=${result.hits} misses=${result.misses} recall=${result.recall.toFixed(3)}${thresholdSummary}`,
      )
      for (const testCase of result.cases) {
        const label = testCase.id ? `${testCase.id}: ${testCase.query}` : testCase.query
        const status = testCase.hit ? pc.green("hit") : pc.red("miss")
        const rank = testCase.bestRank === null ? "n/a" : String(testCase.bestRank)
        console.log(`${status} rank=${rank} topK=${testCase.topK} ${label}`)
        if (!testCase.hit) {
          console.log(`  expected=${testCase.expectedPaths.join(",")}`)
          console.log(`  returned=${testCase.returnedPaths.join(",")}`)
        }
      }
      if (!passed) {
        process.exitCode = 1
      }
    },
  )

program
  .command("audit")
  .description("Compare supported files on disk with the current vector index.")
  .option("--unsupported", "List skipped file paths and reasons.")
  .option("--json", "Print machine-readable JSON.")
  .action(async (options: { unsupported?: boolean; json?: boolean }, command: Command) => {
    const cwd = projectRoot(command)
    const report = await audit(cwd)
    if (options.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    console.log(`supportedFiles=${report.supportedFiles.length}`)
    console.log(`skippedFiles=${report.skippedFiles.length}`)
    console.log(
      `unsupportedFiles=${report.skippedFiles.filter((file) => file.reason === "unsupported-extension").length}`,
    )
    console.log(`indexedFiles=${report.indexedFiles.length}`)
    console.log(`totalChunks=${report.totalChunks}`)
    console.log(`emptyTextFiles=${report.emptyTextFiles.length}`)
    console.log(`missingFromIndex=${report.missingFromIndex.length}`)
    console.log(`staleInIndex=${report.staleInIndex.length}`)
    console.log(`duplicateCandidates=${report.sourceDiagnostics.duplicateCandidates.length}`)
    console.log(`archiveCandidates=${report.sourceDiagnostics.archiveCandidates.length}`)
    console.log(`mirrorCandidates=${report.sourceDiagnostics.mirrorCandidates.length}`)
    printUnsupportedSummary(report.unsupportedExtensions)

    for (const file of report.missingFromIndex) {
      console.log(pc.yellow(`missing: ${file}`))
    }
    for (const file of report.staleInIndex) {
      console.log(pc.red(`stale: ${file}`))
    }
    if (options.unsupported) {
      for (const file of report.skippedFiles) {
        console.log(
          pc.yellow(
            `skipped: ${file.relativePath} reason=${file.reason} recommendation=${file.recommendation}`,
          ),
        )
      }
      for (const candidate of report.sourceDiagnostics.duplicateCandidates) {
        console.log(
          pc.yellow(`duplicate-candidate: ${candidate.key} files=${candidate.files.join(",")}`),
        )
      }
      for (const candidate of report.sourceDiagnostics.archiveCandidates) {
        console.log(
          pc.yellow(`archive-candidate: ${candidate.relativePath} reason=${candidate.reason}`),
        )
      }
      for (const candidate of report.sourceDiagnostics.mirrorCandidates) {
        console.log(
          pc.yellow(`mirror-candidate: ${candidate.relativePath} reason=${candidate.reason}`),
        )
      }
    } else if (report.skippedFiles.length > 0) {
      console.log(pc.yellow("Run `mimir audit --unsupported` to list skipped file paths."))
    }

    if (report.missingFromIndex.length > 0 || report.staleInIndex.length > 0) {
      process.exitCode = 1
    }
  })

program
  .command("usage-report")
  .description("Summarize the metadata-only local access log.")
  .option("--days <number>", "Number of recent days to include.", parsePositiveInt, 7)
  .option("--json", "Print machine-readable JSON.")
  .action(async (options: { days: number; json?: boolean }, command: Command) => {
    const cwd = projectRoot(command)
    const report = await accessLogUsageReport({ cwd, days: options.days })
    if (options.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }

    console.log(`accessLogEnabled=${report.accessLogEnabled}`)
    console.log(`since=${report.since}`)
    console.log(`until=${report.until}`)
    console.log(`totalEvents=${report.totalEvents}`)
    console.log(`invalidLines=${report.invalidLines}`)
    console.log(`uniqueQueryHashes=${report.uniqueQueryHashes}`)
    console.log(`averageResultCount=${report.averageResultCount ?? "n/a"}`)
    console.log(`lastEventAt=${report.lastEventAt ?? "n/a"}`)
    for (const [action, count] of Object.entries(report.eventsByAction)) {
      console.log(`events.${action}=${count}`)
    }
  })

program
  .command("status")
  .description("Show active configuration and index row count.")
  .option("--json", "Print machine-readable JSON.")
  .action(async (options: { json?: boolean }, command: Command) => {
    const cwd = projectRoot(command)
    const config = await loadConfig(cwd)
    const rows = await countRows(config)
    const status = {
      projectRoot: config.projectRoot,
      rawDir: config.rawDir,
      storageDir: config.storageDir,
      sourcesFile: config.sourcesFile,
      accessLogPath: config.accessLogPath,
      embeddingModelPath: config.embeddingModelPath,
      embeddingProvider: config.embeddingProvider,
      embeddingModel: config.embeddingModel,
      transformersAllowRemoteModels: config.transformersAllowRemoteModels,
      redactionEnabled: config.redaction.enabled,
      accessLog: config.accessLog,
      mcpMaxTopK: config.mcpMaxTopK,
      topK: config.topK,
      chunkSize: config.chunkSize,
      chunkOverlap: config.chunkOverlap,
      maxFileBytes: config.maxFileBytes,
      ingestConcurrency: config.ingestConcurrency,
      embeddingBatchSize: config.embeddingBatchSize,
      includeExtensions: config.includeExtensions,
      pdfOcrCommand: config.pdfOcrCommand,
      pdfOcrTimeoutMs: config.pdfOcrTimeoutMs,
      imageOcrCommand: config.imageOcrCommand,
      imageOcrTimeoutMs: config.imageOcrTimeoutMs,
      legacyWordCommand: config.legacyWordCommand,
      legacyWordTimeoutMs: config.legacyWordTimeoutMs,
      chunksIndexed: rows,
    }
    if (options.json) {
      console.log(JSON.stringify(status, null, 2))
      return
    }

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
    console.log(`topK=${config.topK}`)
    console.log(`chunkSize=${config.chunkSize}`)
    console.log(`chunkOverlap=${config.chunkOverlap}`)
    console.log(`maxFileBytes=${config.maxFileBytes}`)
    console.log(`ingestConcurrency=${config.ingestConcurrency}`)
    console.log(`embeddingBatchSize=${config.embeddingBatchSize}`)
    console.log(`includeExtensions=${config.includeExtensions.join(",")}`)
    console.log(`pdfOcrCommand=${config.pdfOcrCommand.join(" ")}`)
    console.log(`pdfOcrTimeoutMs=${config.pdfOcrTimeoutMs}`)
    console.log(`imageOcrCommand=${config.imageOcrCommand.join(" ")}`)
    console.log(`imageOcrTimeoutMs=${config.imageOcrTimeoutMs}`)
    console.log(`legacyWordCommand=${config.legacyWordCommand.join(" ")}`)
    console.log(`legacyWordTimeoutMs=${config.legacyWordTimeoutMs}`)
    console.log(`chunksIndexed=${rows}`)
  })

program
  .command("security-audit")
  .description("Show local privacy, provider, redaction, MCP, and gitignore posture.")
  .option("--json", "Print machine-readable JSON.")
  .option("--strict", "Exit with code 1 when warnings are present.")
  .action(async (options: { json?: boolean; strict?: boolean }, command: Command) => {
    const cwd = projectRoot(command)
    const report = await securityAudit(cwd)
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
  .description("Remove the generated local vector index from Mimir storage.")
  .option("--yes", "Confirm deletion without an interactive prompt.")
  .action(async (options: { yes?: boolean }, command: Command) => {
    const cwd = projectRoot(command)
    if (!options.yes) {
      console.error(pc.red("Refusing to delete the index without --yes."))
      process.exitCode = 1
      return
    }

    const result = await destroyIndex(cwd)
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
  .action(async (textFile: string | undefined, options: AudioOptions, command: Command) => {
    const cwd = projectRoot(command)
    const tts = await loadTts()

    if (options.doctor) {
      const report = await tts.doctor()
      printMaybeJson(report, options.json)
      return
    }

    if (!textFile) {
      console.error(pc.red("Missing text file. Use `mimir audio <text-file>`."))
      process.exitCode = 1
      return
    }

    const renderOptions: TtsRenderOptions = {
      cwd,
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
  .action(async (_options: unknown, command: Command) => {
    const explicitRoot = explicitProjectRoot(command)
    await serveMcp(explicitRoot)
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
  .action(async (options: { targetDir: string }, command: Command) => {
    const cwd = projectRoot(command)
    const result = await installSkill({ cwd, targetDir: options.targetDir })
    const doctorCommand = await mimirCommand(cwd, ["doctor"])
    console.log("Installed Mimir agent kit:")
    for (const file of result.written) {
      console.log(`  - ${file}`)
    }
    console.log(`Skill path: ${result.skillPath}`)
    console.log(`Optional audio skill path: ${result.audioSkillPath}`)
    console.log(`Optional Markdown report skill path: ${result.reportSkillPath}`)
    console.log(`MCP config example: ${result.mcpConfigPath}`)
    console.log(`Claude Code MCP server JSON: ${result.claudeConfigPath}`)
    console.log(`Codex config TOML snippet: ${result.codexConfigPath}`)
    console.log(`Kimi MCP config JSON: ${result.kimiConfigPath}`)
    console.log(`OpenCode config JSONC: ${result.opencodeConfigPath}`)
    console.log(`Cline MCP config JSON: ${result.clineConfigPath}`)
    console.log(`Agent setup guide: ${result.agentSetupPath}`)
    console.log("")
    console.log("Next steps:")
    console.log("  1. Run `mimir install-agent --agents claude` or another targeted agent list.")
    console.log("  2. Add the MCP config from .mimir/ to the same agent when MCP tools are needed.")
    console.log(`  3. Run \`${doctorCommand.display}\` before relying on retrieved context.`)
  })

program
  .command("install-agent")
  .description("Install Mimir skills into native Claude, Codex, Kimi, OpenCode, or Cline folders.")
  .option(
    "--agents <list>",
    `Comma-separated agents: all, ${SUPPORTED_AGENT_TARGETS.join(", ")}.`,
    "all",
  )
  .option("--scope <scope>", "Install scope: project or user.", "project")
  .option("--mode <mode>", "Expose skills as links or physical copies: link or copy.", "link")
  .option("--json", "Print machine-readable JSON.")
  .action(
    async (
      options: { agents: string; scope: string; mode: string; json?: boolean },
      command: Command,
    ) => {
      const cwd = projectRoot(command)
      const scope = parseAgentInstallScope(options.scope)
      const mode = parseAgentInstallMode(options.mode)
      const agents = parseAgentTargets(options.agents)
      const result = await installAgentSkills({ cwd, agents, scope, mode })
      if (options.json) {
        console.log(JSON.stringify(result, null, 2))
        return
      }

      console.log(`Installed Mimir skills for ${scope}-scope agent discovery:`)
      for (const installation of result.installations) {
        console.log(`  - ${installation.label}: ${installation.targetDir} (${installation.mode})`)
      }
      console.log("")
      console.log("MCP helper files:")
      console.log(`  - generic: ${result.projectKit.mcpConfigPath}`)
      console.log(`  - Claude Code: ${result.projectKit.claudeConfigPath}`)
      console.log(`  - Codex: ${result.projectKit.codexConfigPath}`)
      console.log(`  - Kimi: ${result.projectKit.kimiConfigPath}`)
      console.log(`  - OpenCode: ${result.projectKit.opencodeConfigPath}`)
      console.log(`  - Cline: ${result.projectKit.clineConfigPath}`)
      console.log("")
      console.log("Next steps:")
      console.log("  1. Keep editing the canonical skills under .mimir/skills/.")
      console.log(
        "  2. Restart or reload the selected agent so it discovers the exposed SKILL.md files.",
      )
      console.log(
        "  3. Wire the matching MCP helper if the agent should call Mimir tools directly.",
      )
      console.log(`  4. Run \`${(await mimirCommand(cwd, ["doctor"])).display}\`.`)
    },
  )

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

function parseRecallThreshold(value: string): number {
  const trimmed = value.trim()
  const parsed = Number(trimmed)
  if (trimmed.length === 0 || !Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error("Expected a recall threshold between 0 and 1.")
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

interface GlobalOptions {
  projectRoot?: string
}

function projectRoot(command: Command): string {
  return explicitProjectRoot(command) ?? process.cwd()
}

function explicitProjectRoot(command: Command): string | undefined {
  const options = command.optsWithGlobals<GlobalOptions>()
  return options.projectRoot ? path.resolve(options.projectRoot) : undefined
}

function withTopK(cwd: string, topK: number | undefined): { cwd: string; topK?: number } {
  return topK === undefined ? { cwd } : { cwd, topK }
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

function parseAgentInstallScope(value: string | undefined): AgentInstallScope {
  if (value === "project" || value === "user") {
    return value
  }
  throw new Error("Expected --scope to be project or user.")
}

function parseAgentInstallMode(value: string | undefined): AgentInstallMode {
  if (value === "link" || value === "copy") {
    return value
  }
  throw new Error("Expected --mode to be link or copy.")
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
  console.log(`skippedFiles=${report.skippedFiles}`)
  console.log(`unsupportedFiles=${report.unsupportedFiles}`)
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

function printResearchReport(
  report: ResearchReport | ReturnType<typeof compactResearchReport>,
): void {
  console.log(`query=${report.query}`)
  console.log(`ready=${report.ready}`)
  console.log(`generatedQueries=${report.generatedQueries.length}`)
  console.log(
    `audit.supportedFiles=${report.audit.supportedFiles} audit.indexedFiles=${report.audit.indexedFiles} audit.totalChunks=${report.audit.totalChunks} audit.skippedFiles=${report.audit.skippedFiles} audit.missingFromIndex=${report.audit.missingFromIndex} audit.staleInIndex=${report.audit.staleInIndex}`,
  )
  console.log(`securityWarnings=${report.securityWarnings.length}`)
  console.log(
    `sourceDiagnostics.duplicates=${report.sourceDiagnostics.duplicateCandidates.length} sourceDiagnostics.archives=${report.sourceDiagnostics.archiveCandidates.length} sourceDiagnostics.mirrors=${report.sourceDiagnostics.mirrorCandidates.length}`,
  )

  if (report.sourceDiagnostics.duplicateCandidates.length > 0) {
    console.log("")
    console.log(pc.cyan("Duplicate Candidates:"))
    for (const candidate of report.sourceDiagnostics.duplicateCandidates.slice(0, 5)) {
      console.log(`  - ${candidate.key}: ${candidate.files.join(", ")}`)
    }
  }

  if (report.evidence.length > 0) {
    console.log("")
    console.log(pc.cyan("Evidence:"))
    for (const [index, evidence] of report.evidence.entries()) {
      const distance = evidence.distance === null ? "n/a" : evidence.distance.toFixed(4)
      console.log(
        `  [${index + 1}] ${evidence.relativePath} chunk=${evidence.chunkIndex} distance=${distance}`,
      )
      console.log(`      ${researchEvidencePreview(evidence)}`)
    }
  }

  if (report.codeEvidence.length > 0) {
    console.log("")
    console.log(pc.cyan("Code Evidence:"))
    for (const evidence of report.codeEvidence.slice(0, 10)) {
      console.log(
        `  - ${evidence.relativePath}:${evidence.lineNumber} terms=${evidence.matchedTerms.join(",")}`,
      )
      console.log(`      ${evidence.snippet}`)
    }
  }

  if (report.gaps.length > 0) {
    console.log("")
    console.log(pc.yellow("Gaps:"))
    for (const gap of report.gaps) {
      console.log(pc.yellow(`  - ${gap}`))
    }
  }

  console.log("")
  console.log(pc.cyan("Next Steps:"))
  for (const step of report.nextSteps) {
    console.log(`  - ${step}`)
  }
}

function researchEvidencePreview(
  evidence: ResearchReport["evidence"][number] | { snippet: string },
): string {
  if ("snippet" in evidence) {
    return evidence.snippet
  }
  return evidence.text.replace(/\s+/gu, " ").trim().slice(0, SEARCH_TEXT_PREVIEW_LENGTH)
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
  console.log(`  - report skill: ${result.agentKit.reportSkillPath}`)
  console.log(`  - MCP config: ${result.agentKit.mcpConfigPath}`)
  console.log(`  - Claude Code MCP JSON: ${result.agentKit.claudeConfigPath}`)
  console.log(`  - Codex config TOML: ${result.agentKit.codexConfigPath}`)
  console.log(`  - Kimi MCP JSON: ${result.agentKit.kimiConfigPath}`)
  console.log(`  - OpenCode JSONC: ${result.agentKit.opencodeConfigPath}`)
  console.log(`  - Cline MCP JSON: ${result.agentKit.clineConfigPath}`)
  console.log(`  - agent setup guide: ${result.agentKit.agentSetupPath}`)
  console.log("")
  console.log(pc.cyan("Index:"))
  if (result.ingested) {
    console.log(
      `  - ingested indexedFiles=${result.ingested.indexedFiles} rebuiltFiles=${result.ingested.rebuiltFiles} reusedFiles=${result.ingested.reusedFiles} chunks=${result.ingested.chunks} skippedFiles=${result.ingested.skippedFiles} emptyTextFiles=${result.ingested.emptyTextFiles.length} errors=${result.ingested.errors.length}`,
    )
    printUnsupportedSummary(result.ingested.unsupportedExtensions)
    printEmptyTextFiles(result.ingested.emptyTextFiles)
  } else if (result.doctor.ready) {
    console.log(`  - already ready chunks=${result.doctor.chunksIndexed}`)
  } else {
    console.log("  - skipped; add supported files or run doctor --fix when ready")
  }
  console.log("")
  printDoctor(result.doctor)
}

function printUnsupportedSummary(extensions: Array<{ extension: string; count: number }>): void {
  if (extensions.length === 0) {
    return
  }
  console.log(
    pc.yellow(
      `unsupportedExtensions=${extensions
        .map((entry) => `${entry.extension}:${entry.count}`)
        .join(",")}`,
    ),
  )
}

function printEmptyTextFiles(files: string[]): void {
  if (files.length === 0) {
    return
  }
  console.log(pc.yellow(`emptyTextFiles=${files.length}`))
  for (const file of files) {
    console.log(pc.yellow(`empty-text: ${file}`))
  }
  console.log(
    pc.yellow(
      "These supported files produced no indexable text. For scanned/image-only sources, configure pdfOcrCommand or imageOcrCommand, or store local OCR text beside the source file.",
    ),
  )
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

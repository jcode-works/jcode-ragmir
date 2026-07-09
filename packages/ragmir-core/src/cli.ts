#!/usr/bin/env node
import path from "node:path"
import type { ChatSource } from "@jcode.labs/ragmir-chat"
import type { TtsLanguage } from "@jcode.labs/ragmir-tts"
import { Command } from "commander"
import pc from "picocolors"
import { accessLogUsageReport } from "./access-log.js"
import {
  audioAllowRemoteModels,
  audioEngine,
  audioLanguage,
  parseAgentInstallMode,
  parseAgentInstallScope,
  parseNonNegativeInt,
  parseNumber,
  parsePositiveInt,
  parseRecallThreshold,
} from "./cli-options.js"
import { loadConfig } from "./config.js"
import { DEFAULT_SKILL_TARGET_DIR } from "./defaults.js"
import { destroyIndex } from "./destroy.js"
import { doctor } from "./doctor.js"
import { pullEmbeddingModel } from "./embeddings.js"
import { evaluateGoldenQueries } from "./evaluate.js"
import { countSkippedByReason } from "./files.js"
import { getIndexFreshnessWarning, getLexicalScanWarning } from "./index-diagnostics.js"
import { audit, ingest } from "./ingest.js"
import { initProject } from "./init.js"
import { serveMcp } from "./mcp.js"
import { rgrCommand } from "./package-manager.js"
import { routePrompt } from "./prompt-routing.js"
import { ask, search } from "./query.js"
import { compactResearchReport, compactSearchResults, research } from "./research.js"
import { securityAudit } from "./security.js"
import { enableSemanticEmbeddings } from "./semantic-config.js"
import { setupProject } from "./setup.js"
import {
  bundledSkillPath,
  installAgentSkills,
  installSkill,
  parseAgentTargets,
  SUPPORTED_AGENT_TARGETS,
} from "./skill.js"
import { addSourceEntries, listSourceEntries } from "./sources.js"
import { countRows } from "./store.js"
import type { ResearchReport } from "./types.js"
import { VERSION } from "./version.js"

const SEARCH_TEXT_PREVIEW_LENGTH = 900
const CHAT_PACKAGE_NAME = "@jcode.labs/ragmir-chat"
const TTS_PACKAGE_NAME = "@jcode.labs/ragmir-tts"
const DEPRECATED_CLI_NAMES = new Set(["ragmir", "kb"])
const PUBLIC_CLI_NAME = "rgr"

const program = new Command()

const deprecatedCliName = deprecatedCliInvocation()
if (deprecatedCliName !== null) {
  console.error(
    pc.yellow(
      `The \`${deprecatedCliName}\` CLI command is deprecated and will be removed in a future release. Use \`rgr\` instead.`,
    ),
  )
}

program
  .name(PUBLIC_CLI_NAME)
  .description("Local-first RAG knowledge base for private project documents.")
  .version(VERSION)
  .option("--project-root <path>", "Run project-scoped commands against this local workspace.")

const modelsCommand = program.command("models").description("Manage local embedding models.")

modelsCommand
  .command("pull")
  .description("Download the configured Transformers.js embedding model into embeddingModelPath.")
  .option("--enable", "Switch Ragmir config to Transformers embeddings after the model is ready.")
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
      console.log("  1. Run `rgr ingest --rebuild` so existing vectors use the semantic model.")
      console.log("  2. Run `rgr doctor` to confirm readiness.")
    } else {
      console.log("  1. Re-run `rgr models pull --enable` to switch Ragmir config safely.")
      console.log("  2. Run `rgr ingest --rebuild` so existing vectors use the semantic model.")
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
      printSetup(result, "Ragmir repair complete.")
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
  .description("Initialize Ragmir, install the agent kit, run doctor, and ingest when safe.")
  .option(
    "--target-dir <path>",
    "Directory where the skill folder should be copied.",
    DEFAULT_SKILL_TARGET_DIR,
  )
  .option(
    "--agents <list>",
    `Agent MCP helpers to generate: all, ${SUPPORTED_AGENT_TARGETS.join(", ")}.`,
    "all",
  )
  .option("--mcp-name <name>", "MCP server name used in generated config.", "ragmir")
  .option("--mcp-command <command>", "Custom MCP stdio command for generated helper files.")
  .option(
    "--mcp-arg <arg>",
    "Argument for --mcp-command. Repeat for multiple arguments.",
    collectOptionValue,
    [],
  )
  .option(
    "--semantic",
    "Download the configured Transformers.js embedding model and enable higher-quality semantic retrieval.",
  )
  .option("--no-ingest", "Skip automatic indexing even when supported files are present.")
  .option("--json", "Print machine-readable JSON.")
  .action(
    async (
      options: {
        targetDir: string
        agents: string
        mcpName: string
        mcpCommand?: string
        mcpArg: string[]
        semantic?: boolean
        ingest?: boolean
        json?: boolean
      },
      command: Command,
    ) => {
      const cwd = projectRoot(command)
      const setupOptions: Parameters<typeof setupProject>[0] = {
        cwd,
        targetDir: options.targetDir,
        agents: parseAgentTargets(options.agents),
        mcpServerName: options.mcpName,
      }
      addOption(setupOptions, "semantic", options.semantic)
      addOption(setupOptions, "ingest", options.ingest)
      addOption(setupOptions, "mcpCommand", options.mcpCommand)
      if (options.mcpArg.length > 0) {
        setupOptions.mcpArgs = options.mcpArg
      }
      const result = await setupProject(setupOptions)
      if (options.json) {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      printSetup(result, "Ragmir setup complete.")
    },
  )

program
  .command("init")
  .description("Create local .ragmir config, raw-document folder, and gitignore rules.")
  .action(async (_options: unknown, command: Command) => {
    const cwd = projectRoot(command)
    const created = await initProject(cwd)
    if (created.length === 0) {
      console.log(pc.green("Already initialized."))
      const doctorCommand = await rgrCommand(cwd, ["doctor"])
      console.log(`Run \`${doctorCommand.display}\` to check readiness.`)
      return
    }
    console.log(pc.green("Created:"))
    for (const file of created) {
      console.log(`  - ${file}`)
    }
    const ingestCommand = await rgrCommand(cwd, ["ingest"])
    const doctorCommand = await rgrCommand(cwd, ["doctor"])
    const searchCommand = await rgrCommand(cwd, ["search", "your question"])
    console.log("")
    console.log(pc.cyan("Next steps:"))
    console.log("  1. Add supported documents under .ragmir/raw/")
    console.log(`  2. Run \`${ingestCommand.display}\``)
    console.log(`  3. Run \`${doctorCommand.display}\``)
    console.log(`  4. Query with \`${searchCommand.display}\``)
  })

const sourcesCommand = program
  .command("sources")
  .description("Manage extra source paths and glob patterns in .ragmir/config.json.")

sourcesCommand
  .command("list")
  .description("List extra source paths and glob patterns.")
  .option("--json", "Print machine-readable JSON.")
  .action(async (options: { json?: boolean }, command: Command) => {
    const cwd = projectRoot(command)
    const result = await listSourceEntries(cwd)
    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }

    console.log(`sourcesFile=${path.relative(cwd, result.sourcesFile) || result.sourcesFile}`)
    if (result.entries.length === 0) {
      console.log("No extra source entries.")
      console.log('Add one with `rgr sources add "../apps/*/docs/**/*.md"`.')
      return
    }
    for (const entry of result.entries) {
      console.log(`  - ${entry}`)
    }
  })

sourcesCommand
  .command("add")
  .description("Add extra source paths or glob patterns.")
  .argument("<entries...>", "Source paths, glob patterns, or ! exclusion patterns.")
  .option("--json", "Print machine-readable JSON.")
  .action(async (entries: string[], options: { json?: boolean }, command: Command) => {
    const cwd = projectRoot(command)
    const result = await addSourceEntries({ cwd, entries })
    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }

    console.log(`sourcesFile=${path.relative(cwd, result.sourcesFile) || result.sourcesFile}`)
    for (const entry of result.added) {
      console.log(pc.green(`added ${entry}`))
    }
    for (const entry of result.skipped) {
      console.log(pc.dim(`skipped existing ${entry}`))
    }
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
    if (result.vectorIndexWarning) {
      console.log(pc.yellow(result.vectorIndexWarning))
    }
    if (result.lexicalIndexWarning) {
      console.log(pc.yellow(result.lexicalIndexWarning))
    }
    if (result.unsupportedFiles > 0 || result.oversizedFiles > 0 || result.sensitiveFiles > 0) {
      const auditCommand = await rgrCommand(cwd, ["audit", "--unsupported"])
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
  .option(
    "--context-radius <number>",
    "Include neighboring chunks around each matched passage.",
    parseNonNegativeInt,
  )
  .option("--compact", "Return short snippets instead of full passages.")
  .option("--json", "Print machine-readable JSON.")
  .action(
    async (
      query: string,
      options: { topK?: number; contextRadius?: number; compact?: boolean; json?: boolean },
      command: Command,
    ) => {
      const cwd = projectRoot(command)
      const results = await search(query, withSearchOptions(cwd, options))
      const outputResults = options.compact ? compactSearchResults(results) : results
      if (options.json) {
        console.log(JSON.stringify({ query, results: outputResults }, null, 2))
        if (results.length === 0) {
          process.exitCode = 1
        }
        return
      }

      if (results.length === 0) {
        const repairCommand = await rgrCommand(cwd, ["doctor", "--fix"])
        console.error(pc.yellow(`No results. Add documents or run \`${repairCommand.display}\`.`))
        process.exitCode = 1
        return
      }

      await printStaleIndexWarnings(cwd)

      for (const [index, result] of outputResults.entries()) {
        const distance = result.distance === null ? "n/a" : result.distance.toFixed(4)
        console.log(
          `\n${pc.cyan(`[${index + 1}] ${result.citation}`)} chunk=${result.chunkIndex} distance=${distance}`,
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
  .option(
    "--context-radius <number>",
    "Include neighboring chunks around each matched passage.",
    parseNonNegativeInt,
  )
  .option("--json", "Print machine-readable JSON.")
  .action(
    async (
      query: string,
      options: { topK?: number; contextRadius?: number; json?: boolean },
      command: Command,
    ) => {
      const cwd = projectRoot(command)
      const result = await ask(query, withSearchOptions(cwd, options))
      if (options.json) {
        console.log(JSON.stringify({ query, ...result }, null, 2))
        if (result.sources.length === 0) {
          process.exitCode = 1
        }
        return
      }

      console.log(`\n${result.answer}\n`)
      if (result.staleWarning) {
        console.error(pc.yellow(result.staleWarning))
      }
      if (result.sources.length > 0) {
        console.log(pc.dim("Sources:"))
        for (const [index, source] of result.sources.entries()) {
          console.log(`  [${index + 1}] ${source.citation} chunk=${source.chunkIndex}`)
        }
      }
    },
  )

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
  .command("route-prompt")
  .description("Classify a prompt and suggest whether an agent should use Ragmir local context.")
  .argument("[prompt...]", "Prompt text to classify. Reads stdin when omitted.")
  .option("--json", "Print machine-readable JSON.")
  .action(async (promptParts: string[] | undefined, options: { json?: boolean }) => {
    const prompt = await promptInput(promptParts)
    if (prompt.trim().length === 0) {
      console.error(pc.red("Missing prompt. Pass text or pipe it on stdin."))
      process.exitCode = 1
      return
    }

    const decision = routePrompt(prompt)
    if (options.json) {
      console.log(JSON.stringify(decision, null, 2))
      return
    }

    console.log(`shouldUseRagmir=${decision.shouldUseRagmir}`)
    console.log(`confidence=${decision.confidence.toFixed(2)}`)
    console.log(`tool=${decision.tool}`)
    if (decision.query !== null) {
      console.log(`query=${decision.query}`)
    }
    console.log(`reason=${decision.reason}`)
    if (decision.matchedSignals.length > 0) {
      console.log(`matchedSignals=${decision.matchedSignals.join(", ")}`)
    }
  })

program
  .command("evaluate")
  .description("Measure retrieval recall against a JSON golden query file.")
  .requiredOption(
    "--golden <path>",
    "JSON file with queries and expected paths or exact path:Lx-Ly#chunk citations.",
  )
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
        `golden=${result.goldenPath} total=${result.total} hits=${result.hits} misses=${result.misses} recall=${result.recall.toFixed(3)} mrr=${result.meanReciprocalRank.toFixed(3)} ndcg=${result.ndcg.toFixed(3)}${thresholdSummary}`,
      )
      for (const testCase of result.cases) {
        const label = testCase.id ? `${testCase.id}: ${testCase.query}` : testCase.query
        const status = testCase.hit ? pc.green("hit") : pc.red("miss")
        const rank = testCase.bestRank === null ? "n/a" : String(testCase.bestRank)
        console.log(
          `${status} rank=${rank} rr=${testCase.reciprocalRank.toFixed(3)} ndcg=${testCase.ndcg.toFixed(3)} topK=${testCase.topK} ${label}`,
        )
        if (!testCase.hit) {
          const expected =
            testCase.expectedCitations === undefined
              ? testCase.expectedPaths
              : testCase.expectedCitations
          const returned =
            testCase.expectedCitations === undefined
              ? testCase.returnedPaths
              : testCase.returnedCitations
          console.log(`  expected=${expected.join(",")}`)
          console.log(`  returned=${returned.join(",")}`)
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
      `unsupportedFiles=${countSkippedByReason(report.skippedFiles, "unsupported-extension")}`,
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
      console.log(pc.yellow("Run `rgr audit --unsupported` to list skipped file paths."))
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
  .description("Remove the generated local vector index from Ragmir storage.")
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
  .command("chat")
  .description("Answer with a local Transformers.js chat model grounded in Ragmir citations.")
  .argument("[input...]", "Question to answer, or `setup` / `doctor`.")
  .option("-k, --top-k <number>", "Number of passages to retrieve.", parsePositiveInt)
  .option("--model <id>", "Transformers.js text-generation model ID.")
  .option("--model-path <path>", "Local model/cache path.")
  .option("--offline", "Disable remote model loading.")
  .option("--allow-remote-models", "Explicitly allow remote model downloads while answering.")
  .option("--max-new-tokens <number>", "Maximum generated tokens.", parsePositiveInt)
  .option(
    "--context-limit <number>",
    "Maximum context characters sent to the model.",
    parsePositiveInt,
  )
  .option("--dtype <dtype>", "Transformers.js dtype. Default q4.")
  .option("--json", "Print machine-readable JSON.")
  .action(async (input: string[] | undefined, options: ChatOptions, command: Command) => {
    const cwd = projectRoot(command)
    const chat = await loadChat()
    const mode = chatMode(input)

    if (mode === "doctor") {
      const doctorOptions: ChatDoctorOptions = { cwd }
      addOption(doctorOptions, "modelPath", options.modelPath)
      const report = await chat.doctor(doctorOptions)
      printMaybeJson(report, options.json)
      return
    }

    if (mode === "setup") {
      const setupOptions: ChatSetupOptions = { cwd }
      addOption(setupOptions, "model", options.model)
      addOption(setupOptions, "modelPath", options.modelPath)
      addOption(setupOptions, "dtype", options.dtype)
      addOption(setupOptions, "allowRemoteModels", options.offline ? false : undefined)
      const result = await chat.setupChatModel(setupOptions)
      printMaybeJson(result, options.json)
      return
    }

    const question = await promptInput(input)
    if (question.trim().length === 0) {
      console.error(pc.red('Missing question. Use `rgr chat "your question"`.'))
      process.exitCode = 1
      return
    }

    const sources = await search(question, withTopK(cwd, options.topK))
    const chatOptions: ChatGenerateOptions = {
      cwd,
      question,
      sources: sources.map(toChatSource),
    }
    addOption(chatOptions, "model", options.model)
    addOption(chatOptions, "modelPath", options.modelPath)
    addOption(chatOptions, "dtype", options.dtype)
    addOption(chatOptions, "allowRemoteModels", chatAllowRemoteModels(options))
    addOption(chatOptions, "maxNewTokens", options.maxNewTokens)
    addOption(chatOptions, "contextCharLimit", options.contextLimit)

    const result = await chat.generateChatAnswer(chatOptions)
    if (options.json) {
      console.log(JSON.stringify({ query: question, ...result }, null, 2))
      if (result.emptyContext) {
        process.exitCode = 1
      }
      return
    }

    console.log(`\n${result.answer}\n`)
    if (sources.length > 0) {
      console.log(pc.dim("Sources:"))
      for (const [index, source] of sources.entries()) {
        console.log(`  [${index + 1}] ${source.relativePath} chunk=${source.chunkIndex}`)
      }
    } else {
      const repairCommand = await rgrCommand(cwd, ["doctor", "--fix"])
      console.error(pc.yellow(`No Ragmir context found. Run \`${repairCommand.display}\`.`))
      process.exitCode = 1
    }
  })

program
  .command("audio")
  .description("Render a narration text file to local speech audio with Ragmir TTS.")
  .argument("[text-file]", "Narration text file to render.")
  .option("-o, --out <path>", "Output MP3 or WAV path.")
  .option("--engine <engine>", "TTS engine: auto, edge, or transformers.")
  .option("--lang <language>", "TTS language: en, es, fr, ja, th, or zh.")
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
      console.error(pc.red("Missing text file. Use `rgr audio <text-file>`."))
      process.exitCode = 1
      return
    }

    const renderOptions: TtsRenderOptions = {
      cwd,
      textFile,
      engine: audioEngine(options),
    }
    addOption(renderOptions, "language", audioLanguage(options))
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
  .description("Print the bundled Ragmir skill path for agents that can load SKILL.md folders.")
  .action(() => {
    console.log(bundledSkillPath())
  })

program
  .command("install-skill")
  .description("Copy the bundled agent skill and MCP config snippet into the current repository.")
  .option(
    "--target-dir <path>",
    "Directory where the skill folder should be copied.",
    DEFAULT_SKILL_TARGET_DIR,
  )
  .option(
    "--agents <list>",
    `Agent MCP helpers to generate: all, ${SUPPORTED_AGENT_TARGETS.join(", ")}.`,
    "all",
  )
  .option("--mcp-name <name>", "MCP server name used in generated config.", "ragmir")
  .option("--mcp-command <command>", "Custom MCP stdio command for generated helper files.")
  .option(
    "--mcp-arg <arg>",
    "Argument for --mcp-command. Repeat for multiple arguments.",
    collectOptionValue,
    [],
  )
  .action(
    async (
      options: {
        targetDir: string
        agents: string
        mcpName: string
        mcpCommand?: string
        mcpArg: string[]
      },
      command: Command,
    ) => {
      const cwd = projectRoot(command)
      const installOptions: Parameters<typeof installSkill>[0] = {
        cwd,
        targetDir: options.targetDir,
        agents: parseAgentTargets(options.agents),
        mcpServerName: options.mcpName,
      }
      addOption(installOptions, "mcpCommand", options.mcpCommand)
      if (options.mcpArg.length > 0) {
        installOptions.mcpArgs = options.mcpArg
      }
      const result = await installSkill(installOptions)
      const doctorCommand = await rgrCommand(cwd, ["doctor"])
      console.log("Installed Ragmir agent kit:")
      for (const file of result.written) {
        console.log(`  - ${file}`)
      }
      console.log(`Skill path: ${result.skillPath}`)
      console.log(`Optional audio skill path: ${result.audioSkillPath}`)
      console.log(`Optional Markdown report skill path: ${result.reportSkillPath}`)
      console.log(`MCP config example: ${result.mcpConfigPath}`)
      for (const helper of result.agentHelpers) {
        console.log(`${helper.label} MCP helper: ${helper.path}`)
      }
      console.log(`Agent setup guide: ${result.agentSetupPath}`)
      console.log("")
      console.log("Next steps:")
      console.log("  1. Run `rgr install-agent --agents claude` or another targeted agent list.")
      console.log(
        "  2. Add the MCP config from .ragmir/ to the same agent when MCP tools are needed.",
      )
      console.log(`  3. Run \`${doctorCommand.display}\` before relying on retrieved context.`)
    },
  )

program
  .command("install-agent")
  .description("Install Ragmir skills into native Claude, Codex, Kimi, OpenCode, or Cline folders.")
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

      console.log(`Installed Ragmir skills for ${scope}-scope agent discovery:`)
      for (const installation of result.installations) {
        console.log(`  - ${installation.label}: ${installation.targetDir} (${installation.mode})`)
      }
      console.log("")
      console.log("MCP helper files:")
      console.log(`  - generic: ${result.projectKit.mcpConfigPath}`)
      for (const helper of result.projectKit.agentHelpers) {
        console.log(`  - ${helper.label}: ${helper.path}`)
      }
      console.log("")
      console.log("Next steps:")
      console.log("  1. Keep editing the canonical skills under .ragmir/skills/.")
      console.log(
        "  2. Restart or reload the selected agent so it discovers the exposed SKILL.md files.",
      )
      console.log(
        "  3. Wire the matching MCP helper if the agent should call Ragmir tools directly.",
      )
      console.log(`  4. Run \`${(await rgrCommand(cwd, ["doctor"])).display}\`.`)
    },
  )

try {
  await program.parseAsync(process.argv)
} catch (error) {
  console.error(pc.red(error instanceof Error ? error.message : String(error)))
  process.exitCode = 1
}

function collectOptionValue(value: string, previous: string[]): string[] {
  return [...previous, value]
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

function deprecatedCliInvocation(): string | null {
  const invokedPath = process.argv[1]
  if (!invokedPath) return null

  const commandName = path.basename(invokedPath).replace(/\.(?:cmd|ps1)$/iu, "")
  return DEPRECATED_CLI_NAMES.has(commandName) ? commandName : null
}

async function promptInput(promptParts: string[] | undefined): Promise<string> {
  if (promptParts !== undefined && promptParts.length > 0) {
    return promptParts.join(" ")
  }

  if (process.stdin.isTTY) {
    return ""
  }

  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString("utf8")
}

function withTopK(cwd: string, topK: number | undefined): { cwd: string; topK?: number } {
  return topK === undefined ? { cwd } : { cwd, topK }
}

function withSearchOptions(
  cwd: string,
  options: { topK?: number; contextRadius?: number },
): { cwd: string; topK?: number; contextRadius?: number } {
  const result: { cwd: string; topK?: number; contextRadius?: number } = { cwd }
  addOption(result, "topK", options.topK)
  addOption(result, "contextRadius", options.contextRadius)
  return result
}

interface AudioOptions {
  out?: string
  engine?: string
  lang?: string
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

interface ChatOptions {
  topK?: number
  model?: string
  modelPath?: string
  offline?: boolean
  allowRemoteModels?: boolean
  maxNewTokens?: number
  contextLimit?: number
  dtype?: string
  json?: boolean
}

type ChatMode = "ask" | "doctor" | "setup"

interface ChatModule {
  doctor: (options?: ChatDoctorOptions) => Promise<unknown>
  generateChatAnswer: (options: ChatGenerateOptions) => Promise<ChatGenerateResult>
  setupChatModel: (options?: ChatSetupOptions) => Promise<unknown>
}

interface ChatDoctorOptions {
  cwd: string
  modelPath?: string
}

interface ChatSetupOptions {
  cwd: string
  model?: string
  modelPath?: string
  allowRemoteModels?: boolean
  dtype?: string
}

interface ChatGenerateOptions {
  cwd: string
  question: string
  sources: ChatSource[]
  model?: string
  modelPath?: string
  allowRemoteModels?: boolean
  maxNewTokens?: number
  contextCharLimit?: number
  dtype?: string
}

interface ChatGenerateResult {
  answer: string
  emptyContext: boolean
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
  language?: TtsLanguage
  model?: string
  modelPath?: string
  allowRemoteModels?: boolean
  voice?: string
  rate?: string
  speakerEmbeddings?: string
  speed?: number
}

async function loadChat(): Promise<ChatModule> {
  const module: unknown = await import(CHAT_PACKAGE_NAME)
  if (!isChatModule(module)) {
    throw new Error(`${CHAT_PACKAGE_NAME} did not expose the expected chat API.`)
  }
  return module
}

function isChatModule(value: unknown): value is ChatModule {
  return (
    typeof value === "object" &&
    value !== null &&
    "doctor" in value &&
    typeof value.doctor === "function" &&
    "generateChatAnswer" in value &&
    typeof value.generateChatAnswer === "function" &&
    "setupChatModel" in value &&
    typeof value.setupChatModel === "function"
  )
}

function chatMode(input: string[] | undefined): ChatMode {
  if (input?.length === 1 && input[0] === "doctor") {
    return "doctor"
  }
  if (input?.length === 1 && input[0] === "setup") {
    return "setup"
  }
  return "ask"
}

function chatAllowRemoteModels(options: ChatOptions): boolean | undefined {
  if (options.offline) {
    return false
  }
  if (options.allowRemoteModels) {
    return true
  }
  return undefined
}

function toChatSource(source: Awaited<ReturnType<typeof search>>[number]): ChatSource {
  return {
    source: source.source,
    relativePath: source.relativePath,
    chunkIndex: source.chunkIndex,
    text: source.text,
    distance: source.distance,
  }
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

async function printStaleIndexWarnings(cwd: string): Promise<void> {
  const config = await loadConfig(cwd)
  const freshnessWarning = await getIndexFreshnessWarning(config)
  if (freshnessWarning) {
    console.error(pc.yellow(freshnessWarning))
    return
  }
  const chunkCount = await countRows(config)
  const lexicalScanWarning = getLexicalScanWarning(config, chunkCount)
  if (lexicalScanWarning) {
    console.error(pc.yellow(lexicalScanWarning))
  }
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
  console.log(`indexFreshness.manifestFound=${report.indexFreshness.manifestFound}`)
  if (report.indexFreshness.warning) {
    console.log(pc.yellow(`indexFreshness: ${report.indexFreshness.warning}`))
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
  for (const helper of result.agentKit.agentHelpers) {
    console.log(`  - ${helper.label} MCP helper: ${helper.path}`)
  }
  console.log(`  - agent setup guide: ${result.agentKit.agentSetupPath}`)
  console.log("")
  if (result.semantic) {
    console.log(pc.cyan("Semantic retrieval:"))
    console.log("  - enabled for higher-quality natural-language retrieval")
    console.log(`  - embedding model: ${result.semantic.model.embeddingModel}`)
    console.log(`  - model path: ${result.semantic.model.embeddingModelPath}`)
    console.log("  - remote model loading after setup: false")
  } else {
    console.log(pc.cyan("Semantic retrieval:"))
    console.log(
      "  - skipped; default local-hash retrieval is fully local but not semantic. Run `rgr setup --semantic` or `rgr models pull --enable` when a one-time model download is acceptable.",
    )
  }
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
  console.log("")
  printConfigurationPrompt(result.configurationPrompt)
}

function printConfigurationPrompt(prompt: string): void {
  console.log(pc.cyan("AI configuration prompt:"))
  console.log("Copy everything between the markers into your AI assistant or local chat.")
  console.log("-----BEGIN RAGMIR CONFIGURATION PROMPT-----")
  console.log(prompt)
  console.log("-----END RAGMIR CONFIGURATION PROMPT-----")
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

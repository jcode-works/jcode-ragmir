import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import {
  chmod,
  cp,
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const corePackageRoot = path.join(repoRoot, "packages", "ragmir-core")
const cliPath = path.join(corePackageRoot, "dist", "cli.js")
const chatCliPath = path.join(repoRoot, "packages", "ragmir-chat", "dist", "cli.js")
const ttsCliPath = path.join(repoRoot, "packages", "ragmir-tts", "dist", "cli.js")
const tempRoot = await mkdtemp(path.join(tmpdir(), "ragmir-smoke-"))
const MCP_REQUEST_TIMEOUT_MS = 10_000
const MCP_CLOSE_TIMEOUT_MS = 2_000

try {
  const help = await runKb(["--help"], tempRoot)
  if (!help.stdout.startsWith("Usage: rgr ")) {
    throw new Error(`CLI help should expose rgr as the public command.\nActual:\n${help.stdout}`)
  }
  assertNotIncludes(
    help.stdout,
    "ragmir|kb",
    "CLI help should not advertise previous command aliases",
  )
  assertIncludes(help.stdout, "ocr", "CLI help should expose local PDF OCR onboarding")
  const ocrHelp = await runKb(["ocr", "--help"], tempRoot)
  assertIncludes(ocrHelp.stdout, "doctor", "OCR help should expose readiness checks")
  assertIncludes(ocrHelp.stdout, "setup", "OCR help should expose local configuration")
  assertNotIncludes(
    ocrHelp.stdout,
    "extract-page",
    "OCR help should hide the internal page extractor",
  )

  const deprecatedCliPath = path.join(tempRoot, "ragmir")
  await symlink(cliPath, deprecatedCliPath)
  const deprecatedHelp = await runProcess(process.execPath, [deprecatedCliPath, "--help"], tempRoot)
  assertIncludes(
    deprecatedHelp.stderr,
    "The `ragmir` CLI command is deprecated",
    "deprecated ragmir bin should tell users to use rgr",
  )
  assertIncludes(deprecatedHelp.stderr, "Use `rgr` instead.", "deprecated bin should name rgr")

  const deprecatedKbCliPath = path.join(tempRoot, "kb")
  await symlink(cliPath, deprecatedKbCliPath)
  const deprecatedKbHelp = await runProcess(
    process.execPath,
    [deprecatedKbCliPath, "--help"],
    tempRoot,
  )
  assertIncludes(
    deprecatedKbHelp.stderr,
    "The `kb` CLI command is deprecated",
    "deprecated kb bin should tell users to use rgr",
  )
  assertIncludes(deprecatedKbHelp.stderr, "Use `rgr` instead.", "deprecated kb bin should name rgr")

  const ttsHelp = await runProcess(process.execPath, [ttsCliPath], tempRoot)
  assertIncludes(ttsHelp.stdout, "rgr-tts", "TTS help should expose rgr-tts as the public command")
  assertNotIncludes(
    ttsHelp.stdout,
    "ragmir-tts",
    "TTS help should not advertise the previous command alias",
  )

  const deprecatedTtsCliPath = path.join(tempRoot, "ragmir-tts")
  await symlink(ttsCliPath, deprecatedTtsCliPath)
  const deprecatedTtsHelp = await runProcess(process.execPath, [deprecatedTtsCliPath], tempRoot)
  assertIncludes(
    deprecatedTtsHelp.stderr,
    "The `ragmir-tts` CLI command is deprecated",
    "deprecated ragmir-tts bin should tell users to use rgr-tts",
  )
  assertIncludes(
    deprecatedTtsHelp.stderr,
    "Use `rgr-tts` instead.",
    "deprecated TTS bin should name rgr-tts",
  )

  const chatHelp = await runProcess(process.execPath, [chatCliPath], tempRoot)
  assertIncludes(
    chatHelp.stdout,
    "rgr-chat",
    "chat help should expose rgr-chat as the public command",
  )
  assertNotIncludes(
    chatHelp.stdout,
    "ragmir-chat",
    "chat help should not advertise the previous command alias",
  )

  const deprecatedChatCliPath = path.join(tempRoot, "ragmir-chat")
  await symlink(chatCliPath, deprecatedChatCliPath)
  const deprecatedChatHelp = await runProcess(process.execPath, [deprecatedChatCliPath], tempRoot)
  assertIncludes(
    deprecatedChatHelp.stderr,
    "The `ragmir-chat` CLI command is deprecated",
    "deprecated ragmir-chat bin should tell users to use rgr-chat",
  )
  assertIncludes(
    deprecatedChatHelp.stderr,
    "Use `rgr-chat` instead.",
    "deprecated chat bin should name rgr-chat",
  )
  const chatEmptyContext = await runProcess(
    process.execPath,
    [chatCliPath, "answer", "What is covered?", "--json"],
    tempRoot,
  )
  assertIncludes(
    chatEmptyContext.stdout,
    '"emptyContext": true',
    "chat answer without context should return an empty-context result",
  )
  assertIncludes(
    chatEmptyContext.stdout,
    '"allowRemoteModels": false',
    "chat answer without context should keep remote model loading disabled",
  )

  const setup = await runKb(["setup"], tempRoot)
  assertIncludes(
    setup.stdout,
    "Ragmir setup complete.",
    "setup should complete first-run onboarding",
  )
  assertIncludes(setup.stdout, "Agent integration:", "setup should install the agent kit")
  assertIncludes(setup.stdout, "MCP config:", "setup should point users to the MCP config")
  if (existsSync(path.join(tempRoot, ".kb"))) {
    throw new Error("setup should not create a legacy .kb directory for new projects")
  }
  if (existsSync(path.join(tempRoot, "private"))) {
    throw new Error("setup should not create a private directory for new projects")
  }

  const initialDoctor = await runKb(["doctor"], tempRoot)
  assertIncludes(initialDoctor.stdout, "supportedFiles=0", "doctor should ignore generated README")
  assertIncludes(initialDoctor.stdout, "nextSteps:", "doctor should print actionable next steps")
  assertIncludes(
    initialDoctor.stdout,
    "agentKitInstalled=true",
    "setup should leave the agent kit installed",
  )

  const ocrDoctorJson = parseJson(
    (await runKb(["ocr", "doctor", "--json"], tempRoot)).stdout,
    "OCR doctor JSON",
  )
  if (
    typeof ocrDoctorJson.configured !== "boolean" ||
    !Array.isArray(ocrDoctorJson.languages) ||
    typeof ocrDoctorJson.ocrmypdf?.available !== "boolean" ||
    typeof ocrDoctorJson.tesseract?.available !== "boolean" ||
    typeof ocrDoctorJson.pdftoppm?.available !== "boolean"
  ) {
    throw new Error(
      `ocr doctor --json should expose local tool readiness, got ${JSON.stringify(ocrDoctorJson)}`,
    )
  }

  const mcpConfig = await readFile(path.join(tempRoot, ".ragmir", "mcp.json"), "utf8")
  assertIncludes(mcpConfig, '"command": "pnpm"', "default generated MCP config should use pnpm")
  assertIncludes(
    mcpConfig,
    '"serve-mcp"',
    "generated MCP config should launch the Ragmir MCP server",
  )

  await configureProject(tempRoot)
  await writeFixtureDocuments(tempRoot)

  const previewJson = parseJson(
    (
      await runKb(
        ["preview", "--path", ".ragmir/raw/tax.md", "--max-chunks", "1", "--json"],
        tempRoot,
      )
    ).stdout,
    "preview JSON",
  )
  if (
    previewJson.matchedFiles !== 1 ||
    previewJson.files?.[0]?.chunks?.[0]?.contextPath !== "Tax situation" ||
    previewJson.files?.[0]?.chunks?.[0]?.text?.includes("maintainer@example.com")
  ) {
    throw new Error(
      `preview --json should expose redacted structured chunks, got ${JSON.stringify(previewJson)}`,
    )
  }
  if (existsSync(path.join(tempRoot, ".ragmir", "storage", "chunks.lance"))) {
    throw new Error("preview should not create an index table")
  }

  const fixedDoctor = await runKb(["doctor", "--fix"], tempRoot)
  assertIncludes(fixedDoctor.stdout, "Ragmir repair complete.", "doctor --fix should repair setup")
  assertIncludes(
    fixedDoctor.stdout,
    "ingested indexedFiles=2",
    "doctor --fix should ingest supported files when safe",
  )
  assertIncludes(fixedDoctor.stdout, "errors=0", "doctor --fix should surface ingest errors")

  const readyDoctorFix = await runKb(["doctor", "--fix"], tempRoot)
  assertIncludes(
    readyDoctorFix.stdout,
    "already ready chunks=",
    "doctor --fix should report an already-ready index clearly",
  )

  const statusJson = parseJson((await runKb(["status", "--json"], tempRoot)).stdout, "status JSON")
  if (typeof statusJson.chunksIndexed !== "number" || statusJson.chunksIndexed <= 0) {
    throw new Error(`status --json should expose chunksIndexed, got ${statusJson.chunksIndexed}`)
  }
  if (statusJson.mcpMaxOutputBytes !== 32_768) {
    throw new Error(
      `status --json should expose mcpMaxOutputBytes, got ${statusJson.mcpMaxOutputBytes}`,
    )
  }

  const limitsJson = parseJson((await runKb(["limits", "--json"], tempRoot)).stdout, "limits JSON")
  if (
    limitsJson.maxFileBytes !== 50_000_000 ||
    limitsJson.maxFiles !== null ||
    limitsJson.maxCorpusBytes !== null ||
    limitsJson.maxPdfPages !== 1_000
  ) {
    throw new Error(
      `limits --json should expose active safety limits, got ${JSON.stringify(limitsJson)}`,
    )
  }

  const explicitRootStatusJson = parseJson(
    (await runKb(["--project-root", tempRoot, "status", "--json"], repoRoot)).stdout,
    "explicit project root status JSON",
  )
  if (explicitRootStatusJson.projectRoot !== tempRoot) {
    throw new Error(
      `--project-root should scope status to ${tempRoot}, got ${explicitRootStatusJson.projectRoot}`,
    )
  }

  const ingestJson = parseJson((await runKb(["ingest", "--json"], tempRoot)).stdout, "ingest JSON")
  if (!Array.isArray(ingestJson.errors) || ingestJson.errors.length !== 0) {
    throw new Error(`ingest --json should expose an empty errors array, got ${ingestJson.errors}`)
  }
  if (!Array.isArray(ingestJson.emptyTextFiles) || ingestJson.emptyTextFiles.length !== 0) {
    throw new Error(
      `ingest --json should expose emptyTextFiles for supported files with no text, got ${JSON.stringify(
        ingestJson.emptyTextFiles,
      )}`,
    )
  }

  const searchJson = parseJson(
    (
      await runKb(
        [
          "search",
          "French tax residency",
          "--top-k",
          "1",
          "--context-path",
          "Tax situation",
          "--explain",
          "--json",
        ],
        tempRoot,
      )
    ).stdout,
    "search JSON",
  )
  if (searchJson.results?.[0]?.relativePath !== ".ragmir/raw/tax.md") {
    throw new Error(`search --json should return tax.md, got ${JSON.stringify(searchJson)}`)
  }
  if (!searchJson.results?.[0]?.citation?.includes(".ragmir/raw/tax.md:L")) {
    throw new Error(
      `search --json should expose line-aware citations, got ${JSON.stringify(searchJson)}`,
    )
  }
  if (
    searchJson.results?.[0]?.contextPath !== "Tax situation" ||
    searchJson.results?.[0]?.score?.fusion !== "rrf" ||
    typeof searchJson.results?.[0]?.score?.combinedScore !== "number"
  ) {
    throw new Error(
      `search --context-path --explain should expose filtered score evidence, got ${JSON.stringify(searchJson)}`,
    )
  }

  const includedSearchJson = parseJson(
    (
      await runKb(
        ["search", "situation", "--top-k", "5", "--include-path", ".ragmir/raw/tax.md", "--json"],
        tempRoot,
      )
    ).stdout,
    "included search JSON",
  )
  if (
    includedSearchJson.results.length < 1 ||
    !includedSearchJson.results.every((result) => result.relativePath === ".ragmir/raw/tax.md")
  ) {
    throw new Error(
      `search --include-path should constrain source paths, got ${JSON.stringify(includedSearchJson)}`,
    )
  }

  const excludedSearchJson = parseJson(
    (
      await runKb(
        ["search", "situation", "--top-k", "5", "--exclude-path", ".ragmir/raw/tax.md", "--json"],
        tempRoot,
      )
    ).stdout,
    "excluded search JSON",
  )
  if (
    excludedSearchJson.results.length < 1 ||
    excludedSearchJson.results.some((result) => result.relativePath === ".ragmir/raw/tax.md")
  ) {
    throw new Error(
      `search --exclude-path should remove source paths, got ${JSON.stringify(excludedSearchJson)}`,
    )
  }

  const askJson = parseJson(
    (
      await runKb(
        [
          "ask",
          "What proves the French tax residency risk?",
          "--top-k",
          "1",
          "--context-radius",
          "1",
          "--json",
        ],
        tempRoot,
      )
    ).stdout,
    "ask JSON",
  )
  if (!askJson.answer?.includes("Ragmir returns retrieval context only")) {
    throw new Error(
      `ask --json should expose retrieval-only answer, got ${JSON.stringify(askJson)}`,
    )
  }
  if (!Array.isArray(askJson.sources?.[0]?.context) || askJson.sources[0].context.length === 0) {
    throw new Error(`ask --json should expose neighboring context, got ${JSON.stringify(askJson)}`)
  }

  const search = await runKb(["search", "French tax residency", "--top-k", "1"], tempRoot)
  assertIncludes(search.stdout, "tax.md", "search should retrieve the tax document")
  assertIncludes(search.stdout, "French tax residency", "search should return indexed content")

  const ask = await runKb(
    ["ask", "What proves the French tax residency risk?", "--top-k", "1"],
    tempRoot,
  )
  assertIncludes(
    ask.stdout,
    "Ragmir returns retrieval context only",
    "ask should return retrieval context without calling an LLM",
  )

  const usageJson = parseJson(
    (await runKb(["usage-report", "--days", "7", "--json"], tempRoot)).stdout,
    "usage report JSON",
  )
  if (usageJson.totalEvents < 1 || usageJson.uniqueQueryHashes < 1) {
    throw new Error(`usage-report should summarize local usage, got ${JSON.stringify(usageJson)}`)
  }
  if (typeof usageJson.averageResultCountByAction?.search !== "number") {
    throw new Error(
      `usage-report should expose per-action result averages, got ${JSON.stringify(usageJson)}`,
    )
  }
  assertNotIncludes(
    JSON.stringify(usageJson),
    "French tax residency",
    "usage-report should not expose raw query text",
  )
  assertNotIncludes(
    JSON.stringify(usageJson),
    tempRoot,
    "usage-report should not expose local project paths",
  )

  const audit = await runKb(["audit"], tempRoot)
  assertIncludes(audit.stdout, "missingFromIndex=0", "audit should find no missing files")
  assertIncludes(audit.stdout, "staleInIndex=0", "audit should find no stale files")
  assertIncludes(audit.stdout, "chunkStats.p95Chars=", "audit should expose chunk distributions")
  const unsupportedAudit = await runKb(["audit", "--unsupported"], tempRoot)
  assertIncludes(
    unsupportedAudit.stdout,
    "skipped: .ragmir/raw/scan.png reason=unsupported-extension",
    "audit --unsupported should list unsupported image files",
  )
  assertIncludes(
    unsupportedAudit.stdout,
    "Configure imageOcrCommand for local image OCR",
    "audit --unsupported should recommend OCR for image files",
  )

  const doctor = await runKb(["doctor", "--json"], tempRoot)
  assertIncludes(doctor.stdout, '"ready": true', "doctor should report a ready knowledge base")

  const security = await runKb(["security-audit", "--json"], tempRoot)
  assertIncludes(
    security.stdout,
    '"zeroTelemetry": true',
    "security audit should report no telemetry",
  )
  assertIncludes(
    security.stdout,
    '"llmGeneration": false',
    "security audit should report retrieval-only core behavior",
  )

  const audioDoctor = await runKb(["audio", "--doctor", "--json"], tempRoot)
  assertIncludes(
    audioDoctor.stdout,
    '"pythonRequired": false',
    "audio doctor should not require Python",
  )
  assertIncludes(
    audioDoctor.stdout,
    '"outputFormat": "mp3-or-wav"',
    "audio doctor should report MP3 or WAV output",
  )
  assertIncludes(
    audioDoctor.stdout,
    '"defaultEngine": "transformers"',
    "audio doctor should default to the offline/confidential engine",
  )

  const audioMp3WithoutEngine = await runKbFailure(
    ["audio", path.join(tempRoot, ".ragmir", "raw", "tax.md"), "--out", ".ragmir/audio/tax.mp3"],
    tempRoot,
  )
  assertIncludes(
    audioMp3WithoutEngine.stderr,
    "MP3 output uses online Edge TTS",
    "audio should require explicit Edge selection for MP3 output",
  )

  const chatDoctor = await runKb(["chat", "doctor", "--json"], tempRoot)
  assertIncludes(
    chatDoctor.stdout,
    '"provider": "node-llama-cpp"',
    "chat doctor should report the local llama.cpp provider",
  )
  assertIncludes(
    chatDoctor.stdout,
    '"ollamaRequired": false',
    "chat doctor should not require Ollama",
  )

  await runKb(["install-skill"], tempRoot)
  const skill = await readFile(
    path.join(tempRoot, ".ragmir", "skills", "ragmir", "SKILL.md"),
    "utf8",
  )
  const audioSkill = await readFile(
    path.join(tempRoot, ".ragmir", "skills", "ragmir-audio-summary", "SKILL.md"),
    "utf8",
  )
  assertIncludes(skill, "name: ragmir", "install-skill should copy the bundled skill")
  assertIncludes(
    audioSkill,
    "name: ragmir-audio-summary",
    "install-skill should copy the optional audio summary skill",
  )
  const gitignore = await readFile(path.join(tempRoot, ".gitignore"), "utf8")
  assertIncludes(gitignore, ".ragmir/", "setup should ignore local Ragmir state")
  assertNotIncludes(gitignore, ".kb/", "setup should not add legacy .kb ignore rules")
  assertNotIncludes(gitignore, "private/**", "setup should not add legacy private ignore rules")

  await runKb(["install-agent", "--agents", "claude,kimi"], tempRoot)
  const claudeNativeSkillDir = path.join(tempRoot, ".claude", "skills", "ragmir")
  const kimiNativeSkillDir = path.join(tempRoot, ".kimi", "skills", "ragmir")
  const claudeNativeSkill = await readFile(path.join(claudeNativeSkillDir, "SKILL.md"), "utf8")
  const kimiNativeSkill = await readFile(path.join(kimiNativeSkillDir, "SKILL.md"), "utf8")
  assertIncludes(
    claudeNativeSkill,
    "name: ragmir",
    "install-agent should expose the Claude project skill",
  )
  assertIncludes(
    kimiNativeSkill,
    "name: ragmir",
    "install-agent should expose the Kimi project skill",
  )
  await assertSymlinkTarget(
    claudeNativeSkillDir,
    path.join(tempRoot, ".ragmir", "skills", "ragmir"),
    "Claude project skill should link to the canonical Ragmir skill",
  )
  await assertSymlinkTarget(
    kimiNativeSkillDir,
    path.join(tempRoot, ".ragmir", "skills", "ragmir"),
    "Kimi project skill should link to the canonical Ragmir skill",
  )

  await smokeMcp(tempRoot)
  await smokeExampleWorkspace()
  await smokeDocumentBenchmark()

  const destroy = await runKb(["destroy-index", "--yes"], tempRoot)
  assertIncludes(destroy.stdout, "removed=true", "destroy-index should remove generated storage")
  console.log("Smoke test passed.")
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}

async function assertSymlinkTarget(actualPath, expectedTarget, message) {
  const stats = await lstat(actualPath)
  if (!stats.isSymbolicLink()) {
    throw new Error(`${message}: expected a symlink at ${actualPath}`)
  }
  const target = await realpath(actualPath)
  const expected = await realpath(expectedTarget)
  if (target !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${target}`)
  }
}

async function smokeExampleWorkspace() {
  const exampleSource = path.join(corePackageRoot, "examples", "sovereign-rag-demo")
  const exampleTemp = await mkdtemp(path.join(tmpdir(), "ragmir-example-"))

  try {
    await cp(exampleSource, exampleTemp, { recursive: true })
    await configureProject(exampleTemp)
    const initialized = await runKb(["init"], exampleTemp)
    assertIncludes(
      initialized.stdout,
      "Already initialized.",
      "init should harden an existing copied example before strict security checks",
    )
    if (process.platform !== "win32") {
      await chmod(path.join(exampleTemp, "raw"), 0o700)
    }

    const security = await runKb(["security-audit", "--strict"], exampleTemp)
    assertIncludes(
      security.stdout,
      "llmGeneration=false",
      "example security audit should keep LLM generation outside core",
    )

    const ingest = await runKb(["ingest"], exampleTemp)
    assertIncludes(ingest.stdout, "errors=0", "example ingest should complete")

    const audit = await runKb(["audit"], exampleTemp)
    assertIncludes(audit.stdout, "missingFromIndex=0", "example audit should find no missing files")
    assertIncludes(audit.stdout, "staleInIndex=0", "example audit should find no stale files")
    const unsupportedAudit = await runKb(["audit", "--unsupported"], exampleTemp)
    assertIncludes(
      unsupportedAudit.stdout,
      "facility-scan.heic reason=unsupported-extension",
      "example audit should list unsupported scanned document placeholders",
    )
    assertIncludes(
      unsupportedAudit.stdout,
      "Configure imageOcrCommand for local image OCR",
      "example audit should recommend OCR for image-only source evidence",
    )

    const evaluation = parseJson(
      (await runKb(["evaluate", "--golden", "golden-queries.json", "--json"], exampleTemp)).stdout,
      "example evaluation JSON",
    )
    if (
      evaluation.total !== 4 ||
      evaluation.embeddingProvider !== "local-hash" ||
      evaluation.hits !== 4 ||
      evaluation.misses !== 0 ||
      evaluation.recall !== 1
    ) {
      throw new Error(
        `example evaluate should hit every golden query, got ${JSON.stringify(evaluation)}`,
      )
    }

    await writeFile(
      path.join(exampleTemp, "partial-golden-queries.json"),
      `${JSON.stringify(
        {
          queries: [
            {
              id: "known-hit",
              query: "Which dataset was rejected for confidential tests?",
              expectedPaths: ["raw/dataset-inventory.csv"],
            },
            {
              id: "known-miss",
              query: "Which source mentions a non-existent approval?",
              expectedPaths: ["raw/does-not-exist.md"],
            },
          ],
        },
        null,
        2,
      )}\n`,
    )
    const thresholdEvaluation = parseJson(
      (
        await runKb(
          ["evaluate", "--golden", "partial-golden-queries.json", "--fail-under", "0.5", "--json"],
          exampleTemp,
        )
      ).stdout,
      "threshold evaluation JSON",
    )
    if (
      thresholdEvaluation.total !== 2 ||
      thresholdEvaluation.hits !== 1 ||
      thresholdEvaluation.misses !== 1 ||
      thresholdEvaluation.minimumRecall !== 0.5 ||
      thresholdEvaluation.passed !== true
    ) {
      throw new Error(
        `evaluate --fail-under should allow configured recall thresholds, got ${JSON.stringify(
          thresholdEvaluation,
        )}`,
      )
    }
    const thresholdFailure = parseJson(
      (
        await runKbFailure(
          ["evaluate", "--golden", "partial-golden-queries.json", "--fail-under", "0.75", "--json"],
          exampleTemp,
        )
      ).stdout,
      "threshold failure evaluation JSON",
    )
    if (thresholdFailure.recall !== 0.5 || thresholdFailure.passed !== false) {
      throw new Error(
        `evaluate --fail-under should fail when recall is below threshold, got ${JSON.stringify(
          thresholdFailure,
        )}`,
      )
    }

    const approvalSearch = await runKb(
      ["search", "offline retrieval approval", "--top-k", "2"],
      exampleTemp,
    )
    assertIncludes(
      approvalSearch.stdout,
      "review-notes.evidence",
      "example search should retrieve offline approval evidence",
    )

    const customExtensionSearch = await runKb(
      ["search", "offline text-to-speech usage review", "--top-k", "10"],
      exampleTemp,
    )
    assertIncludes(
      customExtensionSearch.stdout,
      "review-notes.evidence",
      "example search should index the custom .evidence extension",
    )

    const retrievalOnlyAsk = await runKb(
      ["ask", "What evidence supports offline operation?", "--top-k", "2"],
      exampleTemp,
    )
    assertIncludes(
      retrievalOnlyAsk.stdout,
      "Ragmir returns retrieval context only",
      "example ask should return cited retrieval context",
    )
  } finally {
    await rm(exampleTemp, { recursive: true, force: true })
  }
}

async function smokeDocumentBenchmark() {
  const benchmarkSource = path.join(corePackageRoot, "examples", "document-evidence-benchmark")
  const benchmarkTemp = await mkdtemp(path.join(tmpdir(), "ragmir-document-benchmark-"))

  try {
    await cp(benchmarkSource, benchmarkTemp, { recursive: true })

    const ingest = await runKb(["ingest"], benchmarkTemp)
    assertIncludes(ingest.stdout, "errors=0", "document benchmark ingest should complete")

    const evaluation = parseJson(
      (
        await runKb(
          ["evaluate", "--golden", "golden-queries.json", "--fail-under", "1", "--json"],
          benchmarkTemp,
        )
      ).stdout,
      "document benchmark evaluation JSON",
    )
    if (
      evaluation.total !== 6 ||
      evaluation.embeddingProvider !== "local-hash" ||
      evaluation.hits !== 6 ||
      evaluation.misses !== 0 ||
      evaluation.recall !== 1 ||
      typeof evaluation.meanReciprocalRank !== "number" ||
      evaluation.meanReciprocalRank <= 0 ||
      typeof evaluation.ndcg !== "number" ||
      evaluation.ndcg <= 0 ||
      evaluation.passed !== true
    ) {
      throw new Error(
        `document benchmark should hit every exact citation, got ${JSON.stringify(evaluation)}`,
      )
    }
    for (const testCase of evaluation.cases ?? []) {
      const expectedCitation = testCase.expectedCitations?.[0]
      if (
        typeof expectedCitation !== "string" ||
        !Array.isArray(testCase.matchedCitations) ||
        !testCase.matchedCitations.includes(expectedCitation)
      ) {
        throw new Error(
          `document benchmark should match exact citations, got ${JSON.stringify(testCase)}`,
        )
      }
    }
    const pdfCase = evaluation.cases?.find(
      (testCase) => testCase.id === "pdf-embedded-text-page-citation",
    )
    if (!pdfCase?.matchedCitations?.includes("raw/contracts/pdf-control-evidence.pdf:p1:L1-L1#0")) {
      throw new Error(
        `document benchmark should extract embedded PDF text with a page citation, got ${JSON.stringify(pdfCase)}`,
      )
    }
  } finally {
    await rm(benchmarkTemp, { recursive: true, force: true })
  }
}

async function configureProject(cwd) {
  const configPath = path.join(cwd, ".ragmir", "config.json")
  const config = JSON.parse(await readFile(configPath, "utf8"))
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        ...config,
        embeddingProvider: "local-hash",
        chunkSize: 500,
        chunkOverlap: 50,
        topK: 2,
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
}

async function writeFixtureDocuments(cwd) {
  await writeFile(
    path.join(cwd, ".ragmir", "raw", "tax.md"),
    [
      "# Tax situation",
      "",
      "French tax residency risk is tied to French clients, a French company, and French invoicing.",
      "The document should be retrieved when the user asks about French tax residency.",
      "Sensitive maintainer email: maintainer@example.com.",
    ].join("\n"),
    "utf8",
  )
  await writeFile(
    path.join(cwd, ".ragmir", "raw", "thailand.md"),
    [
      "# Thailand situation",
      "",
      "Thai DTV status, Bangkok rent, and local daily life support the Thailand relocation context.",
    ].join("\n"),
    "utf8",
  )
  await writeFile(
    path.join(cwd, ".ragmir", "raw", "scan.png"),
    "synthetic image placeholder\n",
    "utf8",
  )
}

async function runKb(args, cwd) {
  return runProcess(process.execPath, [cliPath, ...args], cwd)
}

async function runKbFailure(args, cwd) {
  return runProcess(process.execPath, [cliPath, ...args], cwd, { expectFailure: true })
}

async function runProcess(command, args, cwd, options = {}) {
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const stdout = []
  const stderr = []

  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  child.stdout.on("data", (chunk) => stdout.push(chunk))
  child.stderr.on("data", (chunk) => stderr.push(chunk))

  const code = await new Promise((resolve, reject) => {
    child.on("error", reject)
    child.on("close", resolve)
  })

  const result = { stdout: stdout.join(""), stderr: stderr.join("") }
  if (options.expectFailure) {
    if (code === 0) {
      throw new Error(
        `Command should have failed: ${command} ${args.join(" ")}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      )
    }
    return result
  }
  if (code !== 0) {
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    )
  }
  return result
}

async function smokeMcp(cwd) {
  const child = spawn(process.execPath, [cliPath, "serve-mcp"], {
    cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  })
  const client = createJsonLineClient(child)

  try {
    const initialized = await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "ragmir-smoke", version: "0.0.0" },
    })
    if (!initialized.result?.serverInfo?.name) {
      throw new Error(`MCP initialize failed: ${JSON.stringify(initialized)}`)
    }

    client.notify("notifications/initialized", {})

    const tools = await client.request("tools/list", {})
    assertIncludes(JSON.stringify(tools), "ragmir_status", "MCP should expose ragmir_status")
    assertIncludes(
      JSON.stringify(tools),
      "ragmir_route_prompt",
      "MCP should expose ragmir_route_prompt",
    )
    assertIncludes(JSON.stringify(tools), "ragmir_search", "MCP should expose ragmir_search")
    assertIncludes(JSON.stringify(tools), "ragmir_ask", "MCP should expose ragmir_ask")
    assertIncludes(JSON.stringify(tools), "ragmir_research", "MCP should expose ragmir_research")
    assertIncludes(JSON.stringify(tools), "ragmir_expand", "MCP should expose ragmir_expand")
    assertIncludes(JSON.stringify(tools), "ragmir_audit", "MCP should expose ragmir_audit")
    assertIncludes(JSON.stringify(tools), "ragmir_evaluate", "MCP should expose ragmir_evaluate")
    assertIncludes(
      JSON.stringify(tools),
      "ragmir_usage_report",
      "MCP should expose ragmir_usage_report",
    )
    assertIncludes(
      JSON.stringify(tools),
      "ragmir_security_audit",
      "MCP should expose ragmir_security_audit",
    )

    const status = await client.request("tools/call", {
      name: "ragmir_status",
      arguments: {},
    })
    assertIncludes(mcpText(status), "chunksIndexed", "MCP status should return index metadata")

    const route = await client.request("tools/call", {
      name: "ragmir_route_prompt",
      arguments: { prompt: "Find cited local docs about French tax residency evidence." },
    })
    const routeJson = parseJson(mcpText(route), "MCP route prompt JSON")
    if (routeJson.shouldUseRagmir !== true || routeJson.tool !== "ragmir_search") {
      throw new Error(`MCP route prompt should recommend Ragmir search: ${mcpText(route)}`)
    }

    const search = await client.request("tools/call", {
      name: "ragmir_search",
      arguments: { query: "French tax residency", topK: 1, contextRadius: 1 },
    })
    const searchJson = parseJson(mcpText(search), "MCP search JSON")
    if (
      !Array.isArray(searchJson) ||
      searchJson.length !== 1 ||
      !searchJson[0].citation.includes("tax.md:L") ||
      !Array.isArray(searchJson[0].context) ||
      searchJson[0].context.length < 1
    ) {
      throw new Error(`MCP search should retrieve line-aware context chunks: ${mcpText(search)}`)
    }

    const boundedSearch = await client.request("tools/call", {
      name: "ragmir_search",
      arguments: {
        query: "French tax residency",
        topK: 3,
        compact: true,
        maxBytes: 1_024,
      },
    })
    const boundedSearchJson = parseJson(mcpText(boundedSearch), "bounded MCP search JSON")
    const outputMeta = boundedSearch.result?._meta?.["ragmir/output"]
    if (
      !Array.isArray(boundedSearchJson) ||
      outputMeta?.budgetBytes !== 1_024 ||
      typeof outputMeta.returnedBytes !== "number" ||
      outputMeta.returnedBytes > 1_024
    ) {
      throw new Error(`MCP search should enforce its byte budget: ${JSON.stringify(boundedSearch)}`)
    }

    const expanded = await client.request("tools/call", {
      name: "ragmir_expand",
      arguments: { citation: searchJson[0].citation, contextRadius: 1, maxBytes: 1_024 },
    })
    const expandedJson = parseJson(mcpText(expanded), "MCP citation expansion JSON")
    if (
      expandedJson.found !== true ||
      !Array.isArray(expandedJson.passages) ||
      !expandedJson.passages.some((passage) => passage.citation === searchJson[0].citation)
    ) {
      throw new Error(`MCP should expand an exact returned citation: ${mcpText(expanded)}`)
    }

    const ask = await client.request("tools/call", {
      name: "ragmir_ask",
      arguments: { query: "What proves the French tax residency risk?", topK: 1, contextRadius: 1 },
    })
    const askJson = parseJson(mcpText(ask), "MCP ask JSON")
    if (
      !askJson.answer?.includes(":L") ||
      !Array.isArray(askJson.sources) ||
      askJson.sources.length !== 1 ||
      typeof askJson.sources[0].citation !== "string" ||
      !askJson.sources[0].citation.includes(":L") ||
      !Array.isArray(askJson.sources[0].context)
    ) {
      throw new Error(`MCP ask should return cited retrieval context: ${mcpText(ask)}`)
    }

    const research = await client.request("tools/call", {
      name: "ragmir_research",
      arguments: { query: "French tax residency", topK: 2, compact: true },
    })
    const researchJson = parseJson(mcpText(research), "MCP research JSON")
    if (!Array.isArray(researchJson.evidence) || researchJson.evidence.length < 1) {
      throw new Error(`MCP research should return cited evidence: ${mcpText(research)}`)
    }
    if (!("snippet" in researchJson.evidence[0]) || "text" in researchJson.evidence[0]) {
      throw new Error(
        `MCP compact research should return snippet-only evidence: ${mcpText(research)}`,
      )
    }

    const audit = await client.request("tools/call", {
      name: "ragmir_audit",
      arguments: {},
    })
    assertIncludes(mcpText(audit), "missingFromIndex", "MCP audit should return index coverage")

    await writeFile(
      path.join(cwd, "mcp-golden-queries.json"),
      `${JSON.stringify(
        {
          queries: [
            {
              query: "What proves the French tax residency risk?",
              expectedPaths: [".ragmir/raw/tax.md"],
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    )
    const evaluation = await client.request("tools/call", {
      name: "ragmir_evaluate",
      arguments: { goldenPath: "mcp-golden-queries.json", failUnder: 1 },
    })
    const evaluationJson = parseJson(mcpText(evaluation), "MCP evaluation JSON")
    if (evaluationJson.recall !== 1 || evaluationJson.passed !== true) {
      throw new Error(`MCP evaluate should pass the temporary golden set: ${mcpText(evaluation)}`)
    }

    const usage = await client.request("tools/call", {
      name: "ragmir_usage_report",
      arguments: { days: 7 },
    })
    const usageJson = parseJson(mcpText(usage), "MCP usage report JSON")
    if (usageJson.totalEvents < 1) {
      throw new Error(`MCP usage report should summarize local usage: ${mcpText(usage)}`)
    }
    if (usageJson.mcpOutput?.responses < 1 || usageJson.mcpOutput.returnedBytes < 1) {
      throw new Error(`MCP usage report should include output metrics: ${mcpText(usage)}`)
    }

    const security = await client.request("tools/call", {
      name: "ragmir_security_audit",
      arguments: {},
    })
    assertIncludes(mcpText(security), "warnings", "MCP security audit should return posture data")
  } finally {
    await client.close()
  }
}

function createJsonLineClient(child) {
  let nextId = 1
  let buffer = ""
  const pending = new Map()
  const stderr = []

  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  child.stdout.on("data", (chunk) => {
    buffer += chunk
    let newlineIndex = buffer.indexOf("\n")
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      newlineIndex = buffer.indexOf("\n")
      if (!line) {
        continue
      }
      const message = JSON.parse(line)
      const entry = pending.get(message.id)
      if (entry) {
        clearTimeout(entry.timeout)
        pending.delete(message.id)
        entry.resolve(message)
      }
    }
  })
  child.stderr.on("data", (chunk) => stderr.push(chunk))
  child.on("close", () => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timeout)
      entry.reject(new Error(`MCP process closed before response.\nstderr:\n${stderr.join("")}`))
    }
    pending.clear()
  })

  return {
    request(method, params) {
      const id = nextId
      nextId += 1
      const message = { jsonrpc: "2.0", id, method, params }
      child.stdin.write(`${JSON.stringify(message)}\n`)
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id)
          reject(
            new Error(`Timed out waiting for MCP response ${id}.\nstderr:\n${stderr.join("")}`),
          )
        }, MCP_REQUEST_TIMEOUT_MS)
        pending.set(id, { resolve, reject, timeout })
      })
    },
    notify(method, params) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`)
    },
    async close() {
      child.kill("SIGTERM")
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          child.kill("SIGKILL")
          resolve()
        }, MCP_CLOSE_TIMEOUT_MS)
        child.on("close", () => {
          clearTimeout(timeout)
          resolve()
        })
      })
    },
  }
}

function mcpText(response) {
  const content = response.result?.content
  if (!Array.isArray(content)) {
    return JSON.stringify(response)
  }
  return content.map((item) => item.text ?? "").join("\n")
}

function assertIncludes(actual, expected, message) {
  if (!actual.includes(expected)) {
    throw new Error(`${message}\nExpected to find: ${expected}\nActual:\n${actual}`)
  }
}

function assertNotIncludes(actual, unexpected, message) {
  if (actual.includes(unexpected)) {
    throw new Error(`${message}\nDid not expect to find: ${unexpected}\nActual:\n${actual}`)
  }
}

function parseJson(stdout, label) {
  try {
    return JSON.parse(stdout)
  } catch (error) {
    throw new Error(`${label} should be valid JSON.\n${error}\nActual:\n${stdout}`)
  }
}

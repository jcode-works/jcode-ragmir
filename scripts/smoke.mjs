import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { cp, lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const corePackageRoot = path.join(repoRoot, "packages", "mimir-core")
const cliPath = path.join(corePackageRoot, "dist", "cli.js")
const tempRoot = await mkdtemp(path.join(tmpdir(), "mimir-smoke-"))
const MCP_REQUEST_TIMEOUT_MS = 10_000
const MCP_CLOSE_TIMEOUT_MS = 2_000

try {
  const help = await runKb(["--help"], tempRoot)
  if (!help.stdout.startsWith("Usage: mimir ")) {
    throw new Error(`CLI help should expose Mimir as the public command.\nActual:\n${help.stdout}`)
  }
  assertNotIncludes(
    help.stdout,
    "mimir|kb",
    "CLI help should not advertise the legacy kb compatibility alias",
  )

  const setup = await runKb(["setup"], tempRoot)
  assertIncludes(
    setup.stdout,
    "Mimir setup complete.",
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

  const mcpConfig = await readFile(path.join(tempRoot, ".mimir", "mcp.json"), "utf8")
  assertIncludes(mcpConfig, '"command": "pnpm"', "default generated MCP config should use pnpm")
  assertIncludes(
    mcpConfig,
    '"serve-mcp"',
    "generated MCP config should launch the Mimir MCP server",
  )

  await configureProject(tempRoot)
  await writeFixtureDocuments(tempRoot)

  const fixedDoctor = await runKb(["doctor", "--fix"], tempRoot)
  assertIncludes(fixedDoctor.stdout, "Mimir repair complete.", "doctor --fix should repair setup")
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
    (await runKb(["search", "French tax residency", "--top-k", "1", "--json"], tempRoot)).stdout,
    "search JSON",
  )
  if (searchJson.results?.[0]?.relativePath !== ".mimir/raw/tax.md") {
    throw new Error(`search --json should return tax.md, got ${JSON.stringify(searchJson)}`)
  }

  const askJson = parseJson(
    (
      await runKb(
        ["ask", "What proves the French tax residency risk?", "--top-k", "1", "--json"],
        tempRoot,
      )
    ).stdout,
    "ask JSON",
  )
  if (!askJson.answer?.includes("Mimir returns retrieval context only")) {
    throw new Error(
      `ask --json should expose retrieval-only answer, got ${JSON.stringify(askJson)}`,
    )
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
    "Mimir returns retrieval context only",
    "ask should return retrieval context without calling an LLM",
  )

  const usageJson = parseJson(
    (await runKb(["usage-report", "--days", "7", "--json"], tempRoot)).stdout,
    "usage report JSON",
  )
  if (usageJson.totalEvents < 1 || usageJson.uniqueQueryHashes < 1) {
    throw new Error(`usage-report should summarize local usage, got ${JSON.stringify(usageJson)}`)
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
  const unsupportedAudit = await runKb(["audit", "--unsupported"], tempRoot)
  assertIncludes(
    unsupportedAudit.stdout,
    "skipped: .mimir/raw/scan.png reason=unsupported-extension",
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
    ["audio", path.join(tempRoot, ".mimir", "raw", "tax.md"), "--out", ".mimir/audio/tax.mp3"],
    tempRoot,
  )
  assertIncludes(
    audioMp3WithoutEngine.stderr,
    "MP3 output uses online Edge TTS",
    "kb audio should require explicit Edge selection for MP3 output",
  )

  await runKb(["install-skill"], tempRoot)
  const skill = await readFile(path.join(tempRoot, ".mimir", "skills", "mimir", "SKILL.md"), "utf8")
  const audioSkill = await readFile(
    path.join(tempRoot, ".mimir", "skills", "mimir-audio-summary", "SKILL.md"),
    "utf8",
  )
  assertIncludes(skill, "name: mimir", "install-skill should copy the bundled skill")
  assertIncludes(
    audioSkill,
    "name: mimir-audio-summary",
    "install-skill should copy the optional audio summary skill",
  )
  const gitignore = await readFile(path.join(tempRoot, ".gitignore"), "utf8")
  assertIncludes(gitignore, ".mimir/", "setup should ignore local Mimir state")
  assertNotIncludes(gitignore, ".kb/", "setup should not add legacy .kb ignore rules")
  assertNotIncludes(gitignore, "private/**", "setup should not add legacy private ignore rules")

  await runKb(["install-agent", "--agents", "claude,kimi"], tempRoot)
  const claudeNativeSkillDir = path.join(tempRoot, ".claude", "skills", "mimir")
  const kimiNativeSkillDir = path.join(tempRoot, ".kimi", "skills", "mimir")
  const claudeNativeSkill = await readFile(path.join(claudeNativeSkillDir, "SKILL.md"), "utf8")
  const kimiNativeSkill = await readFile(path.join(kimiNativeSkillDir, "SKILL.md"), "utf8")
  assertIncludes(
    claudeNativeSkill,
    "name: mimir",
    "install-agent should expose the Claude project skill",
  )
  assertIncludes(
    kimiNativeSkill,
    "name: mimir",
    "install-agent should expose the Kimi project skill",
  )
  await assertSymlinkTarget(
    claudeNativeSkillDir,
    path.join(tempRoot, ".mimir", "skills", "mimir"),
    "Claude project skill should link to the canonical Mimir skill",
  )
  await assertSymlinkTarget(
    kimiNativeSkillDir,
    path.join(tempRoot, ".mimir", "skills", "mimir"),
    "Kimi project skill should link to the canonical Mimir skill",
  )

  await smokeMcp(tempRoot)
  await smokeExampleWorkspace()

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
  const exampleTemp = await mkdtemp(path.join(tmpdir(), "mimir-example-"))

  try {
    await cp(exampleSource, exampleTemp, { recursive: true })
    await configureProject(exampleTemp)

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
      "Mimir returns retrieval context only",
      "example ask should return cited retrieval context",
    )
  } finally {
    await rm(exampleTemp, { recursive: true, force: true })
  }
}

async function configureProject(cwd) {
  const configPath = path.join(cwd, ".mimir", "config.json")
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
    path.join(cwd, ".mimir", "raw", "tax.md"),
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
    path.join(cwd, ".mimir", "raw", "thailand.md"),
    [
      "# Thailand situation",
      "",
      "Thai DTV status, Bangkok rent, and local daily life support the Thailand relocation context.",
    ].join("\n"),
    "utf8",
  )
  await writeFile(
    path.join(cwd, ".mimir", "raw", "scan.png"),
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
      clientInfo: { name: "mimir-smoke", version: "0.0.0" },
    })
    if (!initialized.result?.serverInfo?.name) {
      throw new Error(`MCP initialize failed: ${JSON.stringify(initialized)}`)
    }

    client.notify("notifications/initialized", {})

    const tools = await client.request("tools/list", {})
    assertIncludes(JSON.stringify(tools), "mimir_search", "MCP should expose mimir_search")
    assertIncludes(JSON.stringify(tools), "mimir_research", "MCP should expose mimir_research")
    assertIncludes(JSON.stringify(tools), "mimir_evaluate", "MCP should expose mimir_evaluate")
    assertIncludes(
      JSON.stringify(tools),
      "mimir_usage_report",
      "MCP should expose mimir_usage_report",
    )

    const status = await client.request("tools/call", {
      name: "mimir_status",
      arguments: {},
    })
    assertIncludes(mcpText(status), "chunksIndexed", "MCP status should return index metadata")

    const search = await client.request("tools/call", {
      name: "mimir_search",
      arguments: { query: "French tax residency", topK: 1 },
    })
    assertIncludes(mcpText(search), "tax.md", "MCP search should retrieve indexed content")

    const research = await client.request("tools/call", {
      name: "mimir_research",
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

    await writeFile(
      path.join(cwd, "mcp-golden-queries.json"),
      `${JSON.stringify(
        {
          queries: [
            {
              query: "What proves the French tax residency risk?",
              expectedPaths: [".mimir/raw/tax.md"],
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    )
    const evaluation = await client.request("tools/call", {
      name: "mimir_evaluate",
      arguments: { goldenPath: "mcp-golden-queries.json", failUnder: 1 },
    })
    const evaluationJson = parseJson(mcpText(evaluation), "MCP evaluation JSON")
    if (evaluationJson.recall !== 1 || evaluationJson.passed !== true) {
      throw new Error(`MCP evaluate should pass the temporary golden set: ${mcpText(evaluation)}`)
    }

    const usage = await client.request("tools/call", {
      name: "mimir_usage_report",
      arguments: { days: 7 },
    })
    const usageJson = parseJson(mcpText(usage), "MCP usage report JSON")
    if (usageJson.totalEvents < 1) {
      throw new Error(`MCP usage report should summarize local usage: ${mcpText(usage)}`)
    }
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

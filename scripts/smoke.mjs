import { spawn } from "node:child_process"
import { cp, lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const corePackageRoot = path.join(repoRoot, "packages", "mimir")
const cliPath = path.join(corePackageRoot, "dist", "cli.js")
const tempRoot = await mkdtemp(path.join(tmpdir(), "mimir-smoke-"))
const MCP_REQUEST_TIMEOUT_MS = 10_000
const MCP_CLOSE_TIMEOUT_MS = 2_000

try {
  const setup = await runKb(["setup"], tempRoot)
  assertIncludes(
    setup.stdout,
    "Mimir setup complete.",
    "setup should complete first-run onboarding",
  )
  assertIncludes(setup.stdout, "Agent integration:", "setup should install the agent kit")
  assertIncludes(setup.stdout, "MCP config:", "setup should point users to the MCP config")

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

  const audit = await runKb(["audit"], tempRoot)
  assertIncludes(audit.stdout, "missingFromIndex=0", "audit should find no missing files")
  assertIncludes(audit.stdout, "staleInIndex=0", "audit should find no stale files")

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
    ["audio", path.join(tempRoot, "private", "tax.md"), "--out", ".mimir/audio/tax.mp3"],
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
  assertIncludes(gitignore, ".kb/", "init should ignore the Mimir config and index directory")
  assertIncludes(gitignore, ".mimir/", "install-skill should ignore generated agent kit files")

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
  const configPath = path.join(cwd, ".kb", "config.json")
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
    path.join(cwd, "private", "tax.md"),
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
    path.join(cwd, "private", "thailand.md"),
    [
      "# Thailand situation",
      "",
      "Thai DTV status, Bangkok rent, and local daily life support the Thailand relocation context.",
    ].join("\n"),
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

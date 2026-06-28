import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const cliPath = path.join(repoRoot, "dist", "cli.js")
const tempRoot = await mkdtemp(path.join(tmpdir(), "mimir-smoke-"))
const fakeOllama = await startFakeOllama()

try {
  await runKb(["init"], tempRoot)
  await configureProject(tempRoot, fakeOllama.url)
  await writeFixtureDocuments(tempRoot)

  const ingest = await runKb(["ingest"], tempRoot)
  assertIncludes(ingest.stdout, "errors=0", "ingest should complete without parse errors")
  assertIncludes(ingest.stdout, "redactions=", "ingest should report DLP redactions")

  const search = await runKb(["search", "French tax residency", "--top-k", "1"], tempRoot)
  assertIncludes(search.stdout, "tax.md", "search should retrieve the tax document")
  assertIncludes(search.stdout, "French tax residency", "search should return indexed content")

  const ask = await runKb(
    ["ask", "What proves the French tax residency risk?", "--top-k", "1"],
    tempRoot,
  )
  assertIncludes(
    ask.stdout,
    "Fake Mimir answer citing [1].",
    "ask should call the local LLM client",
  )

  const audit = await runKb(["audit"], tempRoot)
  assertIncludes(audit.stdout, "missingFromIndex=0", "audit should find no missing files")
  assertIncludes(audit.stdout, "staleInIndex=0", "audit should find no stale files")

  const security = await runKb(["security-audit", "--json"], tempRoot)
  assertIncludes(
    security.stdout,
    '"zeroTelemetry": true',
    "security audit should report no telemetry",
  )
  assertIncludes(
    security.stdout,
    '"classification": "loopback"',
    "security audit should classify local Ollama",
  )

  await runKb(["install-skill"], tempRoot)
  const skill = await readFile(path.join(tempRoot, ".mimir", "skills", "mimir", "SKILL.md"), "utf8")
  assertIncludes(skill, "name: mimir", "install-skill should copy the bundled skill")
  const gitignore = await readFile(path.join(tempRoot, ".gitignore"), "utf8")
  assertIncludes(gitignore, ".kb/", "init should ignore the Mimir config and index directory")
  assertIncludes(gitignore, ".mimir/", "install-skill should ignore generated agent kit files")

  await smokeMcp(tempRoot)

  const destroy = await runKb(["destroy-index", "--yes"], tempRoot)
  assertIncludes(destroy.stdout, "removed=true", "destroy-index should remove generated storage")
  console.log("Smoke test passed.")
} finally {
  await fakeOllama.close()
  await rm(tempRoot, { recursive: true, force: true })
}

async function configureProject(cwd, ollamaHost) {
  const configPath = path.join(cwd, ".kb", "config.json")
  const config = JSON.parse(await readFile(configPath, "utf8"))
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        ...config,
        ollamaHost,
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

async function runProcess(command, args, cwd) {
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
    for (const [id, entry] of pending) {
      clearTimeout(entry.timeout)
      entry.reject(
        new Error(`MCP process closed before response ${id}.\nstderr:\n${stderr.join("")}`),
      )
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
        }, 10_000)
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
        }, 2_000)
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

async function startFakeOllama() {
  const server = createServer(async (request, response) => {
    const body = await readRequestJson(request)

    if (request.url === "/api/embed") {
      const input = Array.isArray(body.input) ? body.input : [body.input]
      writeJson(response, { embeddings: input.map(toEmbedding) })
      return
    }

    if (request.url === "/api/chat") {
      writeJson(response, {
        model: body.model,
        created_at: new Date(0).toISOString(),
        message: {
          role: "assistant",
          content: "Fake Mimir answer citing [1].",
        },
        done: true,
      })
      return
    }

    response.writeHead(404, { "content-type": "application/json" })
    response.end(JSON.stringify({ error: `Unhandled fake Ollama route: ${request.url}` }))
  })

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("Fake Ollama server did not bind to a TCP port.")
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

async function readRequestJson(request) {
  const chunks = []
  for await (const chunk of request) {
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
}

function writeJson(response, body) {
  response.writeHead(200, { "content-type": "application/json" })
  response.end(JSON.stringify(body))
}

function toEmbedding(value) {
  const text = String(value).toLowerCase()
  return [
    countMatches(text, ["tax", "fiscal", "france", "french", "residency"]),
    countMatches(text, ["thai", "thailand", "bangkok", "dtv"]),
    countMatches(text, ["equipment", "subscription", "invoice"]),
    Math.min(text.length / 1000, 1),
  ]
}

function countMatches(text, needles) {
  return needles.reduce((count, needle) => count + (text.includes(needle) ? 1 : 0), 0)
}

function assertIncludes(actual, expected, message) {
  if (!actual.includes(expected)) {
    throw new Error(`${message}\nExpected to find: ${expected}\nActual:\n${actual}`)
  }
}

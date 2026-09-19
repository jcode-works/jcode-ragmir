import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const { packageManager } = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"))
const readme = await readFile(path.join(repoRoot, "packages/ragmir-core/README.md"), "utf8")
const fixture = await mkdtemp(path.join(os.tmpdir(), "ragmir-publish-readme-"))
let publishedManifest
const registry = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json")
  if (request.method !== "PUT" || request.url !== "/ragmir-readme-smoke") {
    response.writeHead(404).end(JSON.stringify({ error: "not_found" }))
    return
  }
  try {
    let body = ""
    for await (const chunk of request) body += chunk.toString()
    publishedManifest = JSON.parse(body)
    response.writeHead(201).end(JSON.stringify({ ok: true }))
  } catch {
    response.writeHead(400).end(JSON.stringify({ error: "invalid_manifest" }))
  }
})

try {
  await new Promise((resolve, reject) => {
    registry.once("error", reject)
    registry.listen(0, "127.0.0.1", resolve)
  })
  const address = registry.address()
  assert(address && typeof address === "object")
  const registryUrl = `http://127.0.0.1:${address.port}/`
  const authFile = path.join(fixture, ".npmrc")
  await writeFile(
    path.join(fixture, "package.json"),
    JSON.stringify({ name: "ragmir-readme-smoke", version: "0.0.0", packageManager }),
  )
  await writeFile(path.join(fixture, "README.md"), readme)
  await writeFile(authFile, `//127.0.0.1:${address.port}/:_authToken=local-readme-test\n`)

  // The isolated registry must never receive release credentials or use CI identity exchange.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/TOKEN|PASSWORD|SECRET|PROXY/iu.test(name)),
  )
  await new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["publish", "--registry", registryUrl, "--no-git-checks"], {
      cwd: fixture,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    })
    let output = ""
    child.stdout.on("data", (chunk) => {
      output = `${output}${chunk}`.slice(-8_000)
    })
    child.stderr.on("data", (chunk) => {
      output = `${output}${chunk}`.slice(-8_000)
    })
    child.once("error", reject)
    child.once("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Local publish exited with ${code}:\n${output}`))
    })
  })

  assert.equal(
    publishedManifest?.versions?.["0.0.0"]?.readme,
    readme,
    "Published version metadata must contain the Core README",
  )
  console.log("Published README metadata smoke passed against an isolated local registry.")
} finally {
  registry.closeAllConnections()
  await new Promise((resolve) => registry.close(resolve))
  await rm(fixture, { recursive: true, force: true })
}

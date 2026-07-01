import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const require = createRequire(import.meta.url)
const config = require("../release.config.cjs")
const expectedVersion = "0.0.0-semantic-smoke.0"

if (!Array.isArray(config.branches) || !config.branches.includes("main")) {
  throw new Error("semantic-release must release from main")
}

const plugins = config.plugins ?? []
if (!plugins.some((plugin) => plugin === "@semantic-release/commit-analyzer")) {
  throw new Error("semantic-release commit analyzer plugin is missing")
}
if (!plugins.some((plugin) => plugin === "@semantic-release/release-notes-generator")) {
  throw new Error("semantic-release release notes plugin is missing")
}
if (!plugins.some((plugin) => Array.isArray(plugin) && plugin[0] === "@semantic-release/exec")) {
  throw new Error("semantic-release exec plugin is missing")
}
if (!plugins.some((plugin) => Array.isArray(plugin) && plugin[0] === "@semantic-release/github")) {
  throw new Error("semantic-release GitHub plugin is missing")
}

run("node", ["scripts/semantic-release-verify.mjs", "--check"])
run("node", ["scripts/semantic-release-prepare.mjs", "--check", expectedVersion])
run("node", ["scripts/semantic-release-publish.mjs", "--check", expectedVersion])

console.log("Semantic release smoke passed.")

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "inherit",
  })
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`)
  }
}

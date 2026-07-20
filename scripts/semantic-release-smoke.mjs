import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { generateNotes, verifyRelease } from "./semantic-release-notes.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const require = createRequire(import.meta.url)
const config = require("../release.config.cjs")
const expectedVersion = "0.0.0-semantic-smoke.0"

if (!Array.isArray(config.branches) || !config.branches.includes("main")) {
  throw new Error("semantic-release must release from main")
}

const plugins = config.plugins ?? []
const pluginName = (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin)
const commitAnalyzer = plugins.find(
  (plugin) => pluginName(plugin) === "@semantic-release/commit-analyzer",
)
if (!commitAnalyzer) {
  throw new Error("semantic-release commit analyzer plugin is missing")
}
const releaseRules = Array.isArray(commitAnalyzer) ? commitAnalyzer[1]?.releaseRules : []
assert.equal(
  releaseRules?.find((rule) => rule.scope === "landing")?.release,
  false,
  "landing-scoped commits must not create a semantic release",
)
if (!plugins.some((plugin) => pluginName(plugin) === "./scripts/semantic-release-notes.mjs")) {
  throw new Error("semantic-release curated release notes plugin is missing")
}
if (!plugins.some((plugin) => pluginName(plugin) === "@semantic-release/exec")) {
  throw new Error("semantic-release exec plugin is missing")
}
if (!plugins.some((plugin) => pluginName(plugin) === "@semantic-release/github")) {
  throw new Error("semantic-release GitHub plugin is missing")
}

run("node", ["scripts/semantic-release-verify.mjs", "--check"])
run("node", ["scripts/semantic-release-prepare.mjs", "--check", expectedVersion])
run("node", ["scripts/semantic-release-publish.mjs", "--check", expectedVersion])

const releaseContext = {
  commits: [
    {
      message: `fix(release): improve public release communication

Release highlights:
- make the public documentation easier to scan without losing technical depth

Release details:
- **Documentation:** shorten every README and link advanced behavior to
  focused guides without losing the complete public context
- **Landing:** replace the repeated hero copy with one clear product statement

Verification:
- pass the complete pnpm validate release gate and preserve wrapped
  verification evidence`,
    },
    {
      message: `fix(release): describe an older release

Release highlights:
- legacy release highlight that must not replace the current release

Release details:
- **Legacy:** previous release detail

Verification:
- previous release verification`,
    },
  ],
  lastRelease: { gitTag: "v0.0.0" },
  nextRelease: { version: expectedVersion, gitTag: `v${expectedVersion}` },
}

verifyRelease({}, releaseContext)
const generatedNotes = generateNotes({}, releaseContext)
for (const expectedHeading of [
  "## Highlights",
  "## What changed",
  "## Verification",
  "## Install or upgrade",
]) {
  assert.match(generatedNotes, new RegExp(expectedHeading, "u"))
}
assert.match(generatedNotes, /Documentation/u)
assert.match(generatedNotes, /Landing/u)
assert.doesNotMatch(generatedNotes, /legacy release highlight/u)
assert.match(
  generatedNotes,
  /link advanced behavior to focused guides without losing the complete public context/u,
)
assert.match(
  generatedNotes,
  /pass the complete pnpm validate release gate and preserve wrapped verification evidence/u,
)
assert.throws(
  () => verifyRelease({}, { commits: [{ message: "fix(core): terse release" }] }),
  /Release commits must contain/u,
)

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

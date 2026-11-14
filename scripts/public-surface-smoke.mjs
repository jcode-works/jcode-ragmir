import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const trackedFiles = gitLines(["ls-files"])
const pathRules = [
  { pattern: /^\.kb\//u, label: "generated Ragmir index/config path" },
  { pattern: /^\.ragmir\//u, label: "generated Ragmir agent-state path" },
  { pattern: /^private\//u, label: "private raw-document path" },
  { pattern: /(^|\/)[^/]+\.pid$/u, label: "local process/journal file" },
  {
    pattern: /^docs\/(?:gtm-validation|private-dogfooding-protocol|dogfooding-frictions)\.md$/u,
    label: "internal validation document",
  },
]
const contentRules = [
  {
    pattern: /BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY/giu,
    label: "private key material",
  },
  {
    pattern: /\b(?:ghp|github_pat|sk_live|sk_test)_[A-Za-z0-9_]+/gu,
    label: "token-shaped secret",
  },
]

const failures = []

for (const file of trackedFiles) {
  for (const rule of pathRules) {
    if (rule.pattern.test(file)) {
      failures.push(`${file}: tracked ${rule.label}`)
    }
  }
}

for (const file of trackedFiles) {
  const absolutePath = path.join(repoRoot, file)
  if (!existsSync(absolutePath)) {
    continue
  }
  const buffer = await readFile(absolutePath)
  if (buffer.includes(0)) {
    continue
  }
  const content = buffer.toString("utf8")
  for (const rule of contentRules) {
    rule.pattern.lastIndex = 0
    for (const match of content.matchAll(rule.pattern)) {
      const line = lineNumber(content, match.index ?? 0)
      failures.push(`${file}:${line}: ${rule.label}: ${match[0]}`)
    }
  }
}

const coreSetupPrompt = await readSetupPrompt(
  "packages/ragmir-core/src/setup-prompt.ts",
  /RAGMIR_SETUP_PROMPT = `([\s\S]*?)`\s*$/u,
)
const landingSetupPrompt = await readSetupPrompt(
  "packages/ragmir-landing/src/content/setup-prompt.ts",
  /RAGMIR_SETUP_PROMPT = `([\s\S]*?)`\s*$/u,
)

if (coreSetupPrompt.length > 4_000) {
  failures.push(`Ragmir setup prompt is ${coreSetupPrompt.length} characters; maximum is 4000`)
}
if (landingSetupPrompt !== coreSetupPrompt) {
  failures.push("landing setup prompt differs from the Core canonical prompt")
}

for (const file of ["README.md", "docs/quick-start.md", "packages/ragmir-core/README.md"]) {
  const content = await readFile(path.join(repoRoot, file), "utf8")
  const prompt = content.match(
    /<!-- ragmir-setup-prompt:start -->[\s\S]*?~~~text\n([\s\S]*?)\n~~~[\s\S]*?<!-- ragmir-setup-prompt:end -->/u,
  )?.[1]
  if (prompt === undefined) {
    failures.push(`${file}: missing complete Ragmir setup prompt block`)
  } else if (prompt !== coreSetupPrompt) {
    failures.push(`${file}: setup prompt differs from the Core canonical prompt`)
  }
}

// The Claude Code plugin ships its own copy of the retrieval skill and pins the npm release its
// MCP launcher runs, because the plugin directory refuses unpinned npx commands.
const coreSkill = await readFile(
  path.join(repoRoot, "packages/ragmir-core/skills/ragmir/SKILL.md"),
  "utf8",
)
const pluginSkill = await readFile(
  path.join(repoRoot, "plugins/ragmir/skills/ragmir/SKILL.md"),
  "utf8",
)
if (pluginSkill !== coreSkill) {
  failures.push("plugins/ragmir/skills/ragmir/SKILL.md differs from the Core retrieval skill")
}
const pluginManifest = JSON.parse(
  await readFile(path.join(repoRoot, "plugins/ragmir/.claude-plugin/plugin.json"), "utf8"),
)
const marketplace = JSON.parse(
  await readFile(path.join(repoRoot, ".claude-plugin/marketplace.json"), "utf8"),
)
const marketplaceEntry = marketplace.plugins?.find((entry) => entry.source === "./plugins/ragmir")
if (!marketplaceEntry || marketplaceEntry.name !== pluginManifest.name) {
  failures.push(".claude-plugin/marketplace.json must list plugins/ragmir under its plugin name")
}
const pluginLauncher = await readFile(
  path.join(repoRoot, "plugins/ragmir/scripts/serve-mcp.mjs"),
  "utf8",
)
const pinnedVersion = pluginLauncher.match(/const RAGMIR_VERSION = "(\d+\.\d+\.\d+)"/u)?.[1]
if (!pinnedVersion) {
  failures.push("plugins/ragmir/scripts/serve-mcp.mjs must pin an exact Ragmir version")
} else {
  // Every launcher, indexing instruction, and install guide must build and read the index with
  // the release the plugin's MCP server runs.
  const pinnedFiles = [
    ...trackedOrNewFiles("plugins/ragmir").filter((file) => /\.(md|json|mjs)$/u.test(file)),
    "docs/agent-integration.md",
  ]
  let pinnedMentions = 0
  for (const file of pinnedFiles) {
    const content = await readFile(path.join(repoRoot, file), "utf8")
    for (const match of content.matchAll(/@jcode\.labs\/ragmir@(\d[^\s`"':)]*)/gu)) {
      pinnedMentions += 1
      if (match[1] !== pinnedVersion) {
        failures.push(
          `${file}: uses @jcode.labs/ragmir@${match[1]}; the launcher pins ${pinnedVersion}`,
        )
      }
    }
  }
  if (pinnedMentions === 0) {
    failures.push("no pinned @jcode.labs/ragmir release found in the plugin files")
  }
}
const pluginVersions = new Set()
for (const manifest of [".claude-plugin", ".codex-plugin", ".cursor-plugin"]) {
  const content = JSON.parse(
    await readFile(path.join(repoRoot, "plugins/ragmir", manifest, "plugin.json"), "utf8"),
  )
  pluginVersions.add(`${content.name}@${content.version}`)
}
if (pluginVersions.size !== 1) {
  failures.push(`plugin manifests disagree on name or version: ${[...pluginVersions].join(", ")}`)
}
const geminiExtension = await readFile(path.join(repoRoot, "gemini-extension.json"), "utf8")
const qwenExtension = await readFile(path.join(repoRoot, "qwen-extension.json"), "utf8")
if (geminiExtension !== qwenExtension) {
  failures.push("qwen-extension.json must match gemini-extension.json")
}
const rootLlms = await readFile(path.join(repoRoot, "llms.txt"), "utf8")
const landingLlms = await readFile(
  path.join(repoRoot, "packages/ragmir-landing/public/llms.txt"),
  "utf8",
)
if (landingLlms !== rootLlms) {
  failures.push("packages/ragmir-landing/public/llms.txt differs from the root llms.txt")
}

if (failures.length > 0) {
  throw new Error(`Public surface smoke failed:\n${failures.join("\n")}`)
}

console.log("Public surface smoke passed.")

function trackedOrNewFiles(directory) {
  return [
    ...new Set([
      ...gitLines(["ls-files", "--", directory]),
      ...gitLines(["ls-files", "--others", "--exclude-standard", "--", directory]),
    ]),
  ]
}

function gitLines(args) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8", shell: false })
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    )
  }
  return result.stdout.split(/\r?\n/u).filter(Boolean)
}

function lineNumber(content, index) {
  return content.slice(0, index).split(/\r?\n/u).length
}

async function readSetupPrompt(relativePath, pattern) {
  const content = await readFile(path.join(repoRoot, relativePath), "utf8")
  const prompt = content.match(pattern)?.[1]
  if (prompt === undefined) {
    throw new Error(`${relativePath}: could not read Ragmir setup prompt`)
  }
  return prompt
}

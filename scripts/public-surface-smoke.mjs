import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parse as parseYaml } from "yaml"

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
// skills.sh and other Agent Skills installers read the root skills/ folder.
await checkPublishedSkills(coreSkill)
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
// Context7 rejects a context7.json beyond these limits (https://context7.com/schema/context7.json).
const context7 = JSON.parse(await readFile(path.join(repoRoot, "context7.json"), "utf8"))
if (typeof context7.description !== "string" || context7.description.length > 500) {
  failures.push("context7.json: description must be a string of at most 500 characters")
}
if (!Array.isArray(context7.rules) || context7.rules.length > 50) {
  failures.push("context7.json: rules must be an array of at most 50 entries")
} else {
  for (const [index, rule] of context7.rules.entries()) {
    if (typeof rule !== "string" || rule.length === 0 || rule.length > 255) {
      failures.push(`context7.json: rule ${index + 1} must hold 1 to 255 characters`)
    }
  }
}

if (failures.length > 0) {
  throw new Error(`Public surface smoke failed:\n${failures.join("\n")}`)
}

console.log("Public surface smoke passed.")

/**
 * Every skill under skills/ must follow the Agent Skills specification (https://agentskills.io):
 * a spec-compliant name equal to its folder, a bounded description, a body under 500 lines, and
 * relative links that resolve. skills.sh.json must group each skill exactly once.
 */
async function checkPublishedSkills(coreSkill) {
  const skillFiles = trackedOrNewFiles("skills").filter((file) => file.endsWith("/SKILL.md"))
  const skillNames = []
  for (const file of skillFiles) {
    const folder = path.basename(path.dirname(file))
    const content = await readFile(path.join(repoRoot, file), "utf8")
    const frontmatter = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/u)
    if (!frontmatter) {
      failures.push(`${file}: missing YAML frontmatter`)
      continue
    }
    let metadata
    try {
      metadata = parseYaml(frontmatter[1])
    } catch (error) {
      failures.push(`${file}: invalid YAML frontmatter: ${error.message}`)
      continue
    }
    const { name, description, compatibility } = metadata ?? {}
    if (typeof name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name) || name.length > 64) {
      failures.push(`${file}: name must be 1-64 lowercase letters, digits, and single hyphens`)
    } else if (name !== folder) {
      failures.push(`${file}: name ${name} must match its folder ${folder}`)
    }
    if (typeof description !== "string" || description.length === 0 || description.length > 1024) {
      failures.push(`${file}: description must hold 1 to 1024 characters`)
    }
    if (
      compatibility !== undefined &&
      (typeof compatibility !== "string" || compatibility.length > 500)
    ) {
      failures.push(`${file}: compatibility must be a string of at most 500 characters`)
    }
    if (metadata?.metadata?.internal !== undefined) {
      failures.push(`${file}: published skills must not be internal`)
    }
    if (frontmatter[2].split("\n").length > 500) {
      failures.push(`${file}: keep SKILL.md under 500 lines and move detail to references/`)
    }
    for (const match of content.matchAll(/\]\((?!https?:|#)([^)\s]+)\)/gu)) {
      if (!existsSync(path.join(repoRoot, path.dirname(file), match[1]))) {
        failures.push(`${file}: broken link ${match[1]}`)
      }
    }
    skillNames.push(name)
  }
  if (!skillNames.includes("ragmir")) {
    failures.push("skills/ragmir/SKILL.md must publish the Core retrieval skill")
  } else if (
    (await readFile(path.join(repoRoot, "skills/ragmir/SKILL.md"), "utf8")) !== coreSkill
  ) {
    failures.push("skills/ragmir/SKILL.md differs from the Core retrieval skill")
  }

  const skillsSh = JSON.parse(await readFile(path.join(repoRoot, "skills.sh.json"), "utf8"))
  const grouped = (skillsSh.groupings ?? []).flatMap((group) => group.skills ?? [])
  for (const name of skillNames) {
    const count = grouped.filter((entry) => entry === name).length
    if (count !== 1) {
      failures.push(
        `skills.sh.json must list skill ${name} in exactly one grouping (found ${count})`,
      )
    }
  }
  for (const entry of grouped) {
    if (!skillNames.includes(entry)) {
      failures.push(`skills.sh.json groups ${entry}, which has no skills/${entry}/SKILL.md`)
    }
  }
}

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

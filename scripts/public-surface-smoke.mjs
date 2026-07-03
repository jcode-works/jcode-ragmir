import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const trackedFiles = gitLines(["ls-files"])
const misleadingSourcePattern = new RegExp(
  [
    ["private", "workspace", "package"].join("\\s+"),
    ["is", "proprietary"].join("\\s+"),
    String.raw`proprietary\s+(?:Tauri|Ragmir|desktop|app|shell)`,
    ["source", "available", "license"].join("\\s+"),
  ].join("|"),
  "giu",
)
const internalCommercialPattern = new RegExp(
  [
    ["Pricing", "Hypothesis"].join("\\s+"),
    ["Willingness", "to", "pay"].join("\\s+"),
    ["Evidence", "Ledger", "Fields"].join("\\s+"),
  ].join("|"),
  "gu",
)
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
    pattern: /https:\/\/ragmir\.jcode\.works\/download[^\s"'`)<]*/giu,
    label: "active-looking Ragmir download URL",
  },
  {
    pattern: /https:\/\/updates\.ragmir\.jcode\.works[^\s"'`)<]*/giu,
    label: "active-looking Ragmir updater URL",
  },
  {
    pattern: /https:\/\/(?:checkout|buy)\.lemonsqueezy\.com[^\s"'`)<]*/giu,
    label: "real Lemon Squeezy checkout URL",
  },
  {
    pattern: /https:\/\/buy\.paddle\.com[^\s"'`)<]*/giu,
    label: "real Paddle checkout URL",
  },
  {
    pattern: /https:\/\/buy\.stripe\.com[^\s"'`)<]*/giu,
    label: "real Stripe checkout URL",
  },
  {
    pattern: /BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY/giu,
    label: "private key material",
  },
  {
    pattern: /\b(?:ghp|github_pat|sk_live|sk_test)_[A-Za-z0-9_]+/gu,
    label: "token-shaped secret",
  },
  {
    pattern: /\bPrivate (?:workspace|Tauri|Astro|Cloudflare Worker|package)\b/gu,
    label: "private package wording in public docs",
  },
  {
    pattern: misleadingSourcePattern,
    label: "misleading proprietary wording for tracked MIT source",
  },
  {
    pattern: internalCommercialPattern,
    label: "internal commercial validation wording",
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

if (failures.length > 0) {
  throw new Error(`Public surface smoke failed:\n${failures.join("\n")}`)
}

console.log("Public surface smoke passed.")

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

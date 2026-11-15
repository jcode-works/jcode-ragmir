#!/usr/bin/env node
// PreToolUse hook for Edit and Write. Keeps Claude out of generated output and lockfiles, and
// points it at the canonical source of the files the repository keeps as exact copies.
import { readFileSync } from "node:fs"
import path from "node:path"
import { CANONICAL_COPIES } from "./copies.mjs"

const input = JSON.parse(readFileSync(0, "utf8"))
const filePath = input.tool_input?.file_path
if (typeof filePath !== "string" || filePath.length === 0) {
  process.exit(0)
}

const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd()
const relative = path.relative(root, path.resolve(root, filePath)).split(path.sep).join("/")
if (relative.startsWith("../") || path.isAbsolute(relative)) {
  process.exit(0)
}

const generated = [
  [/^packages\/[^/]+\/dist\//u, "build output; change the source and rebuild"],
  [/^packages\/ragmir-landing\/\.astro\//u, "Astro build state; change the source and rebuild"],
  [/^release-artifacts\//u, "release output; run `pnpm release:artifacts`"],
  [/^\.ragmir\//u, "local Ragmir state; use the `rgr` CLI or the configuration files"],
  [/(^|\/)node_modules\//u, "installed dependencies; change package.json and run `pnpm install`"],
  [
    /^python\/(?:\.venv|dist|packages\/[^/]+\/dist)\//u,
    "Python build output; run `uv sync` or `uv build`",
  ],
  [/^pnpm-lock\.yaml$/u, "the pnpm lockfile; change package.json and run `pnpm install`"],
  [/^python\/uv\.lock$/u, "the uv lockfile; change a pyproject.toml and run `uv lock` in python/"],
]

for (const [pattern, reason] of generated) {
  if (pattern.test(relative)) {
    block(`${relative} is ${reason}.`)
  }
}

for (const [source, copies] of CANONICAL_COPIES) {
  if (copies.includes(relative)) {
    block(
      `${relative} is an exact copy of ${source}. Edit ${source}; the PostToolUse hook copies it here.`,
    )
  }
}

process.exit(0)

function block(message) {
  process.stderr.write(`Blocked: ${message}\n`)
  process.exit(2)
}

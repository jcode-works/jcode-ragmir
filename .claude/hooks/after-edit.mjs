#!/usr/bin/env node
// PostToolUse hook for Edit and Write. Refreshes the exact copies of a canonical file, then formats
// the edited file with the repository's own tools: Biome for TypeScript, scripts, and JSON, and
// Ruff for Python once `uv sync` has created python/.venv. Problems Biome cannot fix are reported
// back to Claude with exit code 2.
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { CANONICAL_COPIES } from "./copies.mjs"

const input = JSON.parse(readFileSync(0, "utf8"))
const filePath = input.tool_input?.file_path
if (typeof filePath !== "string" || filePath.length === 0) {
  process.exit(0)
}

const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd()
const absolute = path.resolve(root, filePath)
const relative = path.relative(root, absolute).split(path.sep).join("/")
if (relative.startsWith("../") || path.isAbsolute(relative) || !existsSync(absolute)) {
  process.exit(0)
}

for (const copy of CANONICAL_COPIES.get(relative) ?? []) {
  copyFileSync(absolute, path.join(root, copy))
}

if (/\.(?:[cm]?js|tsx?|json|jsonc)$/u.test(relative)) {
  const biome = resolveFromRoot("@biomejs/biome/bin/biome")
  if (biome) {
    const result = spawnSync(
      process.execPath,
      [
        biome,
        "check",
        "--write",
        "--colors=off",
        "--no-errors-on-unmatched",
        "--files-ignore-unknown=true",
        absolute,
      ],
      { cwd: root, encoding: "utf8" },
    )
    if (result.status !== 0) {
      const output = `${result.stdout}${result.stderr}`.trim().split("\n").slice(0, 40).join("\n")
      process.stderr.write(`Biome reported problems in ${relative}:\n${output}\n`)
      process.exit(2)
    }
  }
} else if (relative.startsWith("python/") && relative.endsWith(".py")) {
  const ruff = path.join(
    root,
    "python",
    ".venv",
    process.platform === "win32" ? "Scripts/ruff.exe" : "bin/ruff",
  )
  if (existsSync(ruff)) {
    const pythonRoot = path.join(root, "python")
    spawnSync(ruff, ["check", "--fix", "--quiet", absolute], { cwd: pythonRoot })
    spawnSync(ruff, ["format", "--quiet", absolute], { cwd: pythonRoot })
  }
}

process.exit(0)

function resolveFromRoot(specifier) {
  try {
    return createRequire(path.join(root, "package.json")).resolve(specifier)
  } catch {
    return null
  }
}

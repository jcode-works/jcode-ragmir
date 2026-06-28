import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  KB_GITIGNORE_ENTRY,
  MIMIR_GITIGNORE_ENTRY,
  PRIVATE_DIR,
  PRIVATE_GITIGNORE_ENTRY,
} from "./defaults.js"

export const MIMIR_GITIGNORE_ENTRIES = [
  KB_GITIGNORE_ENTRY,
  MIMIR_GITIGNORE_ENTRY,
  PRIVATE_GITIGNORE_ENTRY,
  `!${PRIVATE_DIR}/`,
  `!${PRIVATE_DIR}/README.md`,
  `!${PRIVATE_DIR}/**/`,
  `!${PRIVATE_DIR}/**/.gitkeep`,
]

export async function ensureMimirGitignore(cwd = process.cwd()): Promise<boolean> {
  const root = path.resolve(cwd)
  const gitignorePath = path.join(root, ".gitignore")
  const current = existsSync(gitignorePath) ? await readFile(gitignorePath, "utf8") : ""
  const currentLines = new Set(
    current
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  )
  const missingEntries = MIMIR_GITIGNORE_ENTRIES.filter((entry) => !currentLines.has(entry))

  if (missingEntries.length === 0) {
    return false
  }

  const hasMimirHeader = currentLines.has("# Mimir") || currentLines.has("# JCode Mimir")
  const block = [hasMimirHeader ? undefined : "# Mimir", ...missingEntries]
    .filter((line) => line !== undefined)
    .join("\n")
  const prefix = current.trimEnd()
  const next = `${prefix ? `${prefix}\n\n` : ""}${block}\n`

  await writeFile(gitignorePath, next, "utf8")
  return true
}

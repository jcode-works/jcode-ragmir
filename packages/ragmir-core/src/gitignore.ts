import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { RAGMIR_GITIGNORE_ENTRY } from "./defaults.js"

export const RAGMIR_GITIGNORE_ENTRIES = [RAGMIR_GITIGNORE_ENTRY]

export async function ensureRagmirGitignore(
  cwd = process.cwd(),
  additionalEntries: readonly string[] = [],
): Promise<boolean> {
  const root = path.resolve(cwd)
  const gitignorePath = path.join(root, ".gitignore")
  const current = existsSync(gitignorePath) ? await readFile(gitignorePath, "utf8") : ""
  const currentLines = new Set(
    current
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  )
  const desiredEntries = [...new Set([...RAGMIR_GITIGNORE_ENTRIES, ...additionalEntries])]
  const missingEntries = desiredEntries.filter((entry) => !currentLines.has(entry))

  if (missingEntries.length === 0) {
    return false
  }

  const hasRagmirHeader = currentLines.has("# Ragmir") || currentLines.has("# JCode Ragmir")
  const block = [hasRagmirHeader ? undefined : "# Ragmir", ...missingEntries]
    .filter((line) => line !== undefined)
    .join("\n")
  const prefix = current.trimEnd()
  const next = `${prefix ? `${prefix}\n\n` : ""}${block}\n`

  await writeFile(gitignorePath, next, "utf8")
  return true
}

import { existsSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import {
  CONFIG_PATH,
  DEFAULT_CONFIG,
  LEGACY_CONFIG_PATH,
  RAGMIR_DIR,
  RETRIEVAL_PROFILE_FIELDS,
  SHARED_CONFIG_FILENAME,
} from "./defaults.js"
import { ensureRagmirGitignore } from "./gitignore.js"
import { ensurePrivateDirectory, hardenPrivateFile } from "./permissions.js"

// Writing the balanced budgets would pin them, so a later `retrievalProfile` change kept topK 8.
// Ranking and MCP defaults stay implicit for the same reason; name and description invite editing.
const IMPLICIT_DEFAULT_FIELDS = new Set([
  ...RETRIEVAL_PROFILE_FIELDS,
  "defaultExcludes",
  "pathPriors",
  "sourceWeights",
  "scopes",
  "collapseLocaleVariants",
  "maxChunksPerDataFile",
  "mcpAllowedRoots",
  "mcpAutoIngest",
  "mcpSeenResults",
])
const INITIAL_CONFIG = Object.fromEntries(
  Object.entries(DEFAULT_CONFIG).filter(([key]) => !IMPLICIT_DEFAULT_FIELDS.has(key)),
)

export async function initProject(cwd = process.cwd()): Promise<string[]> {
  const root = path.resolve(cwd)
  const ragmirDir = path.join(root, RAGMIR_DIR)
  const rawDir = path.join(root, DEFAULT_CONFIG.rawDir)
  const created: string[] = []

  await ensurePrivateDirectory(ragmirDir)
  if (existsSync(rawDir)) {
    await ensurePrivateDirectory(rawDir)
  }

  const configPath = path.join(root, CONFIG_PATH)
  const legacyConfigPath = path.join(root, LEGACY_CONFIG_PATH)
  // A committed ragmir.config.json is the project config; a local copy of the defaults would
  // override every shared key, so init leaves .ragmir/config.json for machine-local overrides.
  const hasConfig = existsSync(configPath) || existsSync(path.join(root, SHARED_CONFIG_FILENAME))
  const hasLegacyConfig = existsSync(legacyConfigPath)
  if (existsSync(configPath)) {
    await hardenPrivateFile(configPath)
  }
  if (hasLegacyConfig) {
    await hardenPrivateFile(legacyConfigPath)
  }
  if (!hasConfig && !hasLegacyConfig) {
    await ensurePrivateDirectory(rawDir)
    await writeFile(configPath, `${JSON.stringify(INITIAL_CONFIG, null, 2)}\n`, "utf8")
    await hardenPrivateFile(configPath)
    created.push(path.relative(root, configPath))
  }

  if (!hasConfig && !hasLegacyConfig) {
    const readmePath = path.join(rawDir, "README.md")
    if (!existsSync(readmePath)) {
      await writeFile(
        readmePath,
        "# Ragmir raw documents\n\nPut local documents to ingest here. Keep this folder ignored by Git.\n",
        "utf8",
      )
      await hardenPrivateFile(readmePath)
      created.push(path.relative(root, readmePath))
    }
  }

  if (await ensureRagmirGitignore(root)) {
    created.push(".gitignore")
  }

  return created
}

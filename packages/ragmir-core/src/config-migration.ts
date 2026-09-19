import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { findProjectConfig, retiredConfigKeys } from "./config.js"
import { mutateProjectConfig } from "./project-config-file.js"

export interface ConfigMigration {
  removedKeys: string[]
  backupPath: string | null
}

export async function migrateRetiredConfig(cwd: string): Promise<ConfigMigration> {
  const location = findProjectConfig(cwd)
  return mutateProjectConfig<ConfigMigration>(location, async (current) => {
    const removedKeys = retiredConfigKeys(current)
    if (removedKeys.length === 0) {
      return { changed: false, value: { removedKeys, backupPath: null } }
    }
    const backupPath = `${location.configPath}.before-core-focus-${randomUUID()}.json`
    await writeFile(backupPath, `${JSON.stringify(current, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    })
    // Preserve operations that the old strict profile disabled implicitly.
    if (current.privacyProfile === "strict") {
      current.transformersAllowRemoteModels = false
      current.pdfOcrCommand = []
      current.imageOcrCommand = []
      current.legacyWordCommand = []
      current.mcpMaxTopK = Math.min(Number(current.mcpMaxTopK) || 5, 5)
      current.mcpMaxOutputBytes = Math.min(Number(current.mcpMaxOutputBytes) || 16_384, 16_384)
    }
    for (const key of removedKeys) delete current[key]
    return { changed: true, value: { removedKeys, backupPath } }
  })
}

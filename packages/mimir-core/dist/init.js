import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CONFIG_PATH, DEFAULT_CONFIG, LEGACY_CONFIG_PATH, LEGACY_DEFAULT_CONFIG, MIMIR_DIR, } from "./defaults.js";
import { ensureMimirGitignore } from "./gitignore.js";
export async function initProject(cwd = process.cwd()) {
    const root = path.resolve(cwd);
    const mimirDir = path.join(root, MIMIR_DIR);
    const rawDir = path.join(root, DEFAULT_CONFIG.rawDir);
    const created = [];
    await mkdir(mimirDir, { recursive: true });
    const configPath = path.join(root, CONFIG_PATH);
    const legacyConfigPath = path.join(root, LEGACY_CONFIG_PATH);
    const hasConfig = existsSync(configPath);
    const hasLegacyConfig = existsSync(legacyConfigPath);
    if (!hasConfig && !hasLegacyConfig) {
        await mkdir(rawDir, { recursive: true });
        await writeFile(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf8");
        created.push(path.relative(root, configPath));
    }
    const sourcesPath = path.resolve(root, hasLegacyConfig && !hasConfig ? LEGACY_DEFAULT_CONFIG.sourcesFile : DEFAULT_CONFIG.sourcesFile);
    if (!existsSync(sourcesPath)) {
        await mkdir(path.dirname(sourcesPath), { recursive: true });
        await writeFile(sourcesPath, "# Optional extra source paths, one per line. Relative paths resolve from the project root.\n", "utf8");
        created.push(path.relative(root, sourcesPath));
    }
    if (!hasConfig && !hasLegacyConfig) {
        const readmePath = path.join(rawDir, "README.md");
        if (!existsSync(readmePath)) {
            await writeFile(readmePath, "# Mimir raw documents\n\nPut local documents to ingest here. Keep this folder ignored by Git.\n", "utf8");
            created.push(path.relative(root, readmePath));
        }
    }
    if (await ensureMimirGitignore(root)) {
        created.push(".gitignore");
    }
    return created;
}
//# sourceMappingURL=init.js.map
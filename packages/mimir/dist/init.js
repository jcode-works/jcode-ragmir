import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CONFIG_PATH, DEFAULT_CONFIG, KB_DIR, PRIVATE_DIR } from "./defaults.js";
import { ensureMimirGitignore } from "./gitignore.js";
export async function initProject(cwd = process.cwd()) {
    const root = path.resolve(cwd);
    const kbDir = path.join(root, KB_DIR);
    const privateDir = path.join(root, PRIVATE_DIR);
    const created = [];
    await mkdir(kbDir, { recursive: true });
    await mkdir(privateDir, { recursive: true });
    const configPath = path.join(root, CONFIG_PATH);
    if (!existsSync(configPath)) {
        await writeFile(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf8");
        created.push(path.relative(root, configPath));
    }
    const sourcesPath = path.join(kbDir, "sources.txt");
    if (!existsSync(sourcesPath)) {
        await writeFile(sourcesPath, "# Optional extra source paths, one per line. Relative paths resolve from the project root.\n", "utf8");
        created.push(path.relative(root, sourcesPath));
    }
    const readmePath = path.join(privateDir, "README.md");
    if (!existsSync(readmePath)) {
        await writeFile(readmePath, "# Private documents\n\nPut raw documents to ingest here. Keep this folder ignored by Git.\n", "utf8");
        created.push(path.relative(root, readmePath));
    }
    if (await ensureMimirGitignore(root)) {
        created.push(".gitignore");
    }
    return created;
}
//# sourceMappingURL=init.js.map
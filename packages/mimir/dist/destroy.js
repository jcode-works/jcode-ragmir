import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { recordAccess } from "./access-log.js";
import { loadConfig } from "./config.js";
export async function destroyIndex(cwd = process.cwd()) {
    const config = await loadConfig(cwd);
    const existed = existsSync(config.storageDir);
    await recordAccess(config, { action: "destroy-index" });
    await rm(config.storageDir, { recursive: true, force: true });
    return {
        storageDir: config.storageDir,
        removed: existed,
        note: "Generated index removed. For forensic deletion guarantees, keep .kb/ on an encrypted volume and rotate/destroy the volume key.",
    };
}
//# sourceMappingURL=destroy.js.map
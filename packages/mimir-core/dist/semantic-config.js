import { readFile, writeFile } from "node:fs/promises";
import { findProjectConfig } from "./config.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import { isRecord } from "./guards.js";
import { initProject } from "./init.js";
export async function enableSemanticEmbeddings(cwd = process.cwd()) {
    await initProject(cwd);
    const projectConfig = findProjectConfig(cwd);
    const rawConfig = JSON.parse(await readFile(projectConfig.configPath, "utf8"));
    if (!isRecord(rawConfig)) {
        throw new Error(`${projectConfig.configPath} must contain a JSON object.`);
    }
    const embeddingModel = typeof rawConfig.embeddingModel === "string"
        ? rawConfig.embeddingModel
        : DEFAULT_CONFIG.embeddingModel;
    const embeddingModelPath = typeof rawConfig.embeddingModelPath === "string"
        ? rawConfig.embeddingModelPath
        : DEFAULT_CONFIG.embeddingModelPath;
    const nextConfig = {
        ...rawConfig,
        embeddingProvider: "transformers",
        embeddingModel,
        embeddingModelPath,
        transformersAllowRemoteModels: false,
    };
    await writeFile(projectConfig.configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
    return {
        configPath: projectConfig.configPath,
        embeddingProvider: "transformers",
        embeddingModel,
        embeddingModelPath,
        transformersAllowRemoteModels: false,
    };
}
//# sourceMappingURL=semantic-config.js.map
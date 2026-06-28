export const KB_DIR = ".kb";
export const MIMIR_DIR = ".mimir";
export const PRIVATE_DIR = "private";
export const CONFIG_PATH = `${KB_DIR}/config.json`;
export const DEFAULT_SKILL_TARGET_DIR = `${MIMIR_DIR}/skills`;
export const KB_GITIGNORE_ENTRY = `${KB_DIR}/`;
export const MIMIR_GITIGNORE_ENTRY = `${MIMIR_DIR}/`;
export const PRIVATE_GITIGNORE_ENTRY = `${PRIVATE_DIR}/**`;
export const DEFAULT_CONFIG = {
    rawDir: PRIVATE_DIR,
    storageDir: `${KB_DIR}/storage`,
    sourcesFile: `${KB_DIR}/sources.txt`,
    accessLogPath: `${KB_DIR}/access.log`,
    embeddingModelPath: `${MIMIR_DIR}/models`,
    tableName: "chunks",
    embeddingProvider: "local-hash",
    embeddingModel: "mixedbread-ai/mxbai-embed-xsmall-v1",
    transformersAllowRemoteModels: false,
    redaction: {
        enabled: true,
        builtIn: true,
        patterns: [],
    },
    accessLog: true,
    mcpMaxTopK: 10,
    topK: 5,
    chunkSize: 1200,
    chunkOverlap: 150,
    includeExtensions: [],
};
//# sourceMappingURL=defaults.js.map
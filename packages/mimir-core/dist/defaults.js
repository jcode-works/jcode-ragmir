export const MIMIR_DIR = ".mimir";
export const LEGACY_KB_DIR = ".kb";
export const LEGACY_PRIVATE_DIR = "private";
export const MIMIR_RAW_DIR = `${MIMIR_DIR}/raw`;
export const CONFIG_PATH = `${MIMIR_DIR}/config.json`;
export const LEGACY_CONFIG_PATH = `${LEGACY_KB_DIR}/config.json`;
export const DEFAULT_SKILL_TARGET_DIR = `${MIMIR_DIR}/skills`;
export const MIMIR_PROJECT_ROOT_ENV = "MIMIR_PROJECT_ROOT";
export const SOURCES_FILE_HEADER = [
    "# Optional extra source paths or glob patterns, one per line.",
    "# Relative paths resolve from the project root. Prefix glob exclusions with !.",
    "# Example: ../apps/*/docs/**/*.md",
    "# Example: !../apps/**/node_modules/**",
    "",
];
export const MIMIR_GITIGNORE_ENTRY = `${MIMIR_DIR}/`;
export const LEGACY_KB_GITIGNORE_ENTRY = `${LEGACY_KB_DIR}/`;
export const LEGACY_PRIVATE_GITIGNORE_ENTRY = `${LEGACY_PRIVATE_DIR}/`;
export const LEGACY_PRIVATE_GITIGNORE_FALLBACK_ENTRY = `${LEGACY_PRIVATE_DIR}/**`;
export const DEFAULT_CONFIG = {
    rawDir: MIMIR_RAW_DIR,
    storageDir: `${MIMIR_DIR}/storage`,
    sourcesFile: `${MIMIR_DIR}/sources.txt`,
    sources: [],
    accessLogPath: `${MIMIR_DIR}/access.log`,
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
    topK: 8,
    chunkSize: 1200,
    chunkOverlap: 200,
    maxFileBytes: 50_000_000,
    ingestConcurrency: 4,
    embeddingBatchSize: 32,
    includeExtensions: [],
    pdfOcrCommand: [],
    pdfOcrTimeoutMs: 120_000,
    imageOcrCommand: [],
    imageOcrTimeoutMs: 120_000,
    legacyWordCommand: [],
    legacyWordTimeoutMs: 120_000,
};
export const LEGACY_DEFAULT_CONFIG = {
    ...DEFAULT_CONFIG,
    rawDir: LEGACY_PRIVATE_DIR,
    storageDir: `${LEGACY_KB_DIR}/storage`,
    sourcesFile: `${LEGACY_KB_DIR}/sources.txt`,
    accessLogPath: `${LEGACY_KB_DIR}/access.log`,
};
//# sourceMappingURL=defaults.js.map
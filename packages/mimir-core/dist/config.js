import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { CONFIG_PATH, DEFAULT_CONFIG, LEGACY_CONFIG_PATH, LEGACY_DEFAULT_CONFIG, } from "./defaults.js";
import { isRecord } from "./guards.js";
const embeddingProviderSchema = z.enum(["local-hash", "transformers"]);
const rawConfigSchema = z.object({
    rawDir: z.string().default(DEFAULT_CONFIG.rawDir),
    storageDir: z.string().default(DEFAULT_CONFIG.storageDir),
    sourcesFile: z.string().default(DEFAULT_CONFIG.sourcesFile),
    sources: z.array(z.string().min(1)).default(DEFAULT_CONFIG.sources),
    accessLogPath: z.string().default(DEFAULT_CONFIG.accessLogPath),
    embeddingModelPath: z.string().default(DEFAULT_CONFIG.embeddingModelPath),
    tableName: z.string().default(DEFAULT_CONFIG.tableName),
    embeddingProvider: embeddingProviderSchema.default(DEFAULT_CONFIG.embeddingProvider),
    embeddingModel: z.string().default(DEFAULT_CONFIG.embeddingModel),
    transformersAllowRemoteModels: z.boolean().default(DEFAULT_CONFIG.transformersAllowRemoteModels),
    redaction: z
        .object({
        enabled: z.boolean().default(DEFAULT_CONFIG.redaction.enabled),
        builtIn: z.boolean().default(DEFAULT_CONFIG.redaction.builtIn),
        patterns: z
            .array(z.object({
            name: z.string().min(1),
            pattern: z.string().min(1),
            flags: z.string().optional(),
            replacement: z.string().optional(),
        }))
            .default(DEFAULT_CONFIG.redaction.patterns),
    })
        .default(DEFAULT_CONFIG.redaction),
    accessLog: z.boolean().default(DEFAULT_CONFIG.accessLog),
    mcpMaxTopK: z.number().int().positive().default(DEFAULT_CONFIG.mcpMaxTopK),
    topK: z.number().int().positive().default(DEFAULT_CONFIG.topK),
    chunkSize: z.number().int().positive().default(DEFAULT_CONFIG.chunkSize),
    chunkOverlap: z.number().int().nonnegative().default(DEFAULT_CONFIG.chunkOverlap),
    maxFileBytes: z.number().int().positive().default(DEFAULT_CONFIG.maxFileBytes),
    ingestConcurrency: z.number().int().positive().default(DEFAULT_CONFIG.ingestConcurrency),
    embeddingBatchSize: z.number().int().positive().default(DEFAULT_CONFIG.embeddingBatchSize),
    includeExtensions: z.array(z.string().min(1)).default(DEFAULT_CONFIG.includeExtensions),
    pdfOcrCommand: z.array(z.string().min(1)).default(DEFAULT_CONFIG.pdfOcrCommand),
    pdfOcrTimeoutMs: z.number().int().positive().default(DEFAULT_CONFIG.pdfOcrTimeoutMs),
    imageOcrCommand: z.array(z.string().min(1)).default(DEFAULT_CONFIG.imageOcrCommand),
    imageOcrTimeoutMs: z.number().int().positive().default(DEFAULT_CONFIG.imageOcrTimeoutMs),
    legacyWordCommand: z.array(z.string().min(1)).default(DEFAULT_CONFIG.legacyWordCommand),
    legacyWordTimeoutMs: z.number().int().positive().default(DEFAULT_CONFIG.legacyWordTimeoutMs),
});
export function findProjectRoot(start = process.cwd()) {
    return findProjectConfig(start).projectRoot;
}
export function findProjectConfig(start = process.cwd()) {
    let current = path.resolve(start);
    while (true) {
        if (existsSync(path.join(current, CONFIG_PATH))) {
            return {
                projectRoot: current,
                configPath: path.join(current, CONFIG_PATH),
                legacy: false,
            };
        }
        if (existsSync(path.join(current, LEGACY_CONFIG_PATH))) {
            return {
                projectRoot: current,
                configPath: path.join(current, LEGACY_CONFIG_PATH),
                legacy: true,
            };
        }
        const parent = path.dirname(current);
        if (parent === current) {
            const projectRoot = path.resolve(start);
            return {
                projectRoot,
                configPath: path.join(projectRoot, CONFIG_PATH),
                legacy: false,
            };
        }
        current = parent;
    }
}
export async function loadConfig(start = process.cwd()) {
    const projectConfig = findProjectConfig(start);
    const hasConfig = existsSync(projectConfig.configPath);
    const raw = hasConfig ? JSON.parse(await readFile(projectConfig.configPath, "utf8")) : {};
    if (!isRecord(raw)) {
        throw new Error(`${path.relative(projectConfig.projectRoot, projectConfig.configPath)} must contain a JSON object.`);
    }
    const defaults = projectConfig.legacy ? LEGACY_DEFAULT_CONFIG : DEFAULT_CONFIG;
    const parsed = rawConfigSchema.parse({ ...defaults, ...raw });
    const withEnv = applyEnv(parsed);
    if (withEnv.chunkOverlap >= withEnv.chunkSize) {
        throw new Error("chunkOverlap must be lower than chunkSize.");
    }
    return {
        projectRoot: projectConfig.projectRoot,
        rawDir: resolveFromRoot(projectConfig.projectRoot, withEnv.rawDir),
        storageDir: resolveFromRoot(projectConfig.projectRoot, withEnv.storageDir),
        sourcesFile: resolveFromRoot(projectConfig.projectRoot, withEnv.sourcesFile),
        sources: withEnv.sources,
        accessLogPath: resolveFromRoot(projectConfig.projectRoot, withEnv.accessLogPath),
        embeddingModelPath: resolveFromRoot(projectConfig.projectRoot, withEnv.embeddingModelPath),
        tableName: withEnv.tableName,
        embeddingProvider: withEnv.embeddingProvider,
        embeddingModel: withEnv.embeddingModel,
        transformersAllowRemoteModels: withEnv.transformersAllowRemoteModels,
        redaction: withEnv.redaction,
        accessLog: withEnv.accessLog,
        mcpMaxTopK: withEnv.mcpMaxTopK,
        topK: withEnv.topK,
        chunkSize: withEnv.chunkSize,
        chunkOverlap: withEnv.chunkOverlap,
        maxFileBytes: withEnv.maxFileBytes,
        ingestConcurrency: withEnv.ingestConcurrency,
        embeddingBatchSize: withEnv.embeddingBatchSize,
        includeExtensions: normalizeExtensions(withEnv.includeExtensions),
        pdfOcrCommand: withEnv.pdfOcrCommand,
        pdfOcrTimeoutMs: withEnv.pdfOcrTimeoutMs,
        imageOcrCommand: withEnv.imageOcrCommand,
        imageOcrTimeoutMs: withEnv.imageOcrTimeoutMs,
        legacyWordCommand: withEnv.legacyWordCommand,
        legacyWordTimeoutMs: withEnv.legacyWordTimeoutMs,
    };
}
function resolveFromRoot(projectRoot, input) {
    return path.isAbsolute(input) ? input : path.resolve(projectRoot, input);
}
function applyEnv(config) {
    return {
        ...config,
        rawDir: readStringEnv("MIMIR_RAW_DIR", "KB_RAW_DIR", config.rawDir),
        storageDir: readStringEnv("MIMIR_STORAGE_DIR", "KB_STORAGE_DIR", config.storageDir),
        sourcesFile: readStringEnv("MIMIR_SOURCES_FILE", "KB_SOURCES_FILE", config.sourcesFile),
        accessLogPath: readStringEnv("MIMIR_ACCESS_LOG_PATH", "KB_ACCESS_LOG_PATH", config.accessLogPath),
        embeddingProvider: readEmbeddingProviderEnv("MIMIR_EMBEDDING_PROVIDER", "KB_EMBEDDING_PROVIDER", config.embeddingProvider),
        embeddingModel: readStringEnv("MIMIR_EMBEDDING_MODEL", "KB_EMBEDDING_MODEL", config.embeddingModel),
        embeddingModelPath: readStringEnv("MIMIR_EMBEDDING_MODEL_PATH", "KB_EMBEDDING_MODEL_PATH", config.embeddingModelPath),
        transformersAllowRemoteModels: readBooleanEnv("MIMIR_TRANSFORMERS_ALLOW_REMOTE_MODELS", "KB_TRANSFORMERS_ALLOW_REMOTE_MODELS", config.transformersAllowRemoteModels),
        redaction: {
            ...config.redaction,
            enabled: readBooleanEnv("MIMIR_REDACTION_ENABLED", "KB_REDACTION_ENABLED", config.redaction.enabled),
            builtIn: readBooleanEnv("MIMIR_REDACTION_BUILT_IN", "KB_REDACTION_BUILT_IN", config.redaction.builtIn),
        },
        accessLog: readBooleanEnv("MIMIR_ACCESS_LOG", "KB_ACCESS_LOG", config.accessLog),
        mcpMaxTopK: readPositiveIntEnv("MIMIR_MCP_MAX_TOP_K", "KB_MCP_MAX_TOP_K", config.mcpMaxTopK),
        topK: readPositiveIntEnv("MIMIR_TOP_K", "KB_TOP_K", config.topK),
        chunkSize: readPositiveIntEnv("MIMIR_CHUNK_SIZE", "KB_CHUNK_SIZE", config.chunkSize),
        chunkOverlap: readNonNegativeIntEnv("MIMIR_CHUNK_OVERLAP", "KB_CHUNK_OVERLAP", config.chunkOverlap),
        maxFileBytes: readPositiveIntEnv("MIMIR_MAX_FILE_BYTES", "KB_MAX_FILE_BYTES", config.maxFileBytes),
        ingestConcurrency: readPositiveIntEnv("MIMIR_INGEST_CONCURRENCY", "KB_INGEST_CONCURRENCY", config.ingestConcurrency),
        embeddingBatchSize: readPositiveIntEnv("MIMIR_EMBEDDING_BATCH_SIZE", "KB_EMBEDDING_BATCH_SIZE", config.embeddingBatchSize),
        includeExtensions: readExtensionsEnv("MIMIR_INCLUDE_EXTENSIONS", "KB_INCLUDE_EXTENSIONS", config.includeExtensions),
        pdfOcrCommand: readJsonStringArrayEnv("MIMIR_PDF_OCR_COMMAND", "KB_PDF_OCR_COMMAND", config.pdfOcrCommand),
        pdfOcrTimeoutMs: readPositiveIntEnv("MIMIR_PDF_OCR_TIMEOUT_MS", "KB_PDF_OCR_TIMEOUT_MS", config.pdfOcrTimeoutMs),
        imageOcrCommand: readJsonStringArrayEnv("MIMIR_IMAGE_OCR_COMMAND", "KB_IMAGE_OCR_COMMAND", config.imageOcrCommand),
        imageOcrTimeoutMs: readPositiveIntEnv("MIMIR_IMAGE_OCR_TIMEOUT_MS", "KB_IMAGE_OCR_TIMEOUT_MS", config.imageOcrTimeoutMs),
        legacyWordCommand: readJsonStringArrayEnv("MIMIR_LEGACY_WORD_COMMAND", "KB_LEGACY_WORD_COMMAND", config.legacyWordCommand),
        legacyWordTimeoutMs: readPositiveIntEnv("MIMIR_LEGACY_WORD_TIMEOUT_MS", "KB_LEGACY_WORD_TIMEOUT_MS", config.legacyWordTimeoutMs),
    };
}
function normalizeExtensions(extensions) {
    return [
        ...new Set(extensions
            .map((extension) => extension.trim().toLowerCase())
            .filter(Boolean)
            .map((extension) => (extension.startsWith(".") ? extension : `.${extension}`))),
    ].sort();
}
function readEmbeddingProviderEnv(name, legacyName, fallback) {
    const parsed = embeddingProviderSchema.safeParse(process.env[name] ?? process.env[legacyName]);
    return parsed.success ? parsed.data : fallback;
}
function readStringEnv(name, legacyName, fallback) {
    return process.env[name] ?? process.env[legacyName] ?? fallback;
}
function readBooleanEnv(name, legacyName, fallback) {
    const raw = (process.env[name] ?? process.env[legacyName])?.toLowerCase();
    if (raw === "1" || raw === "true" || raw === "yes") {
        return true;
    }
    if (raw === "0" || raw === "false" || raw === "no") {
        return false;
    }
    return fallback;
}
function readPositiveIntEnv(name, legacyName, fallback) {
    const raw = process.env[name] ?? process.env[legacyName];
    if (!raw) {
        return fallback;
    }
    const value = Number.parseInt(raw, 10);
    return Number.isInteger(value) && value > 0 ? value : fallback;
}
function readNonNegativeIntEnv(name, legacyName, fallback) {
    const raw = process.env[name] ?? process.env[legacyName];
    if (!raw) {
        return fallback;
    }
    const value = Number.parseInt(raw, 10);
    return Number.isInteger(value) && value >= 0 ? value : fallback;
}
function readExtensionsEnv(name, legacyName, fallback) {
    const raw = process.env[name] ?? process.env[legacyName];
    if (!raw) {
        return fallback;
    }
    return raw.split(",");
}
function readJsonStringArrayEnv(name, legacyName, fallback) {
    const raw = process.env[name] ?? process.env[legacyName];
    if (!raw) {
        return fallback;
    }
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) &&
            parsed.every((value) => typeof value === "string" && value.length > 0)
            ? parsed
            : fallback;
    }
    catch {
        return fallback;
    }
}
//# sourceMappingURL=config.js.map
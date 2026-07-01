import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { DEFAULT_CONFIG, LEGACY_PRIVATE_DIR } from "./defaults.js";
const GENERATED_SOURCE_READMES = new Set([
    `${DEFAULT_CONFIG.rawDir}/README.md`,
    `${LEGACY_PRIVATE_DIR}/README.md`,
]);
const NO_EXTENSION = "(none)";
const SENSITIVE_FILE_NAMES = new Set([
    ".env",
    ".env.local",
    ".env.production",
    ".npmrc",
    ".pypirc",
    ".netrc",
    ".pgpass",
]);
const SENSITIVE_EXTENSIONS = new Set([
    ".crt",
    ".der",
    ".gpg",
    ".jks",
    ".key",
    ".keystore",
    ".p12",
    ".pem",
    ".pfx",
]);
const OCR_IMAGE_EXTENSIONS = new Set([
    ".avif",
    ".bmp",
    ".gif",
    ".heic",
    ".heif",
    ".jpeg",
    ".jpg",
    ".png",
    ".tif",
    ".tiff",
    ".webp",
]);
const LEGACY_WORD_EXTENSIONS = new Set([".doc"]);
const LEGACY_EXCEL_EXTENSIONS = new Set([".xls"]);
const TRANSCRIPTION_EXTENSIONS = new Set([
    ".aac",
    ".aiff",
    ".flac",
    ".m4a",
    ".mkv",
    ".mov",
    ".mp3",
    ".mp4",
    ".ogg",
    ".wav",
    ".webm",
]);
const DEFAULT_SUPPORTED_FILE_NAMES = new Set([
    ".dockerignore",
    ".gitignore",
    ".npmignore",
    "dockerfile",
    "gemfile",
    "gradlew",
    "makefile",
    "mvnw",
    "procfile",
    "rakefile",
]);
export const DEFAULT_SUPPORTED_EXTENSIONS = new Set([
    ".atom",
    ".adoc",
    ".astro",
    ".bash",
    ".bat",
    ".c",
    ".cjs",
    ".cfg",
    ".cmd",
    ".conf",
    ".cpp",
    ".cs",
    ".css",
    ".csv",
    ".cts",
    ".diff",
    ".docx",
    ".eml",
    ".epub",
    ".example",
    ".exemple",
    ".go",
    ".h",
    ".hpp",
    ".htm",
    ".html",
    ".ics",
    ".ini",
    ".java",
    ".js",
    ".json",
    ".jsonl",
    ".jsx",
    ".ipynb",
    ".log",
    ".markdown",
    ".md",
    ".mdown",
    ".mdx",
    ".mmd",
    ".mjs",
    ".mts",
    ".ndjson",
    ".odp",
    ".ods",
    ".odt",
    ".patch",
    ".pdf",
    ".php",
    ".pptx",
    ".properties",
    ".ps1",
    ".py",
    ".rb",
    ".rst",
    ".rs",
    ".rss",
    ".rtf",
    ".scss",
    ".srt",
    ".svelte",
    ".svg",
    ".sh",
    ".sql",
    ".tex",
    ".text",
    ".toml",
    ".ts",
    ".tsv",
    ".tsx",
    ".txt",
    ".vtt",
    ".vue",
    ".xml",
    ".xlsx",
    ".yaml",
    ".yml",
]);
export async function listSourceFiles(config) {
    return (await inventorySourceFiles(config)).supportedFiles;
}
export async function inventorySourceFiles(config) {
    const roots = await sourceRoots(config);
    const files = new Map();
    const skippedFiles = new Map();
    let discoveredFiles = 0;
    for (const root of roots) {
        if (!existsSync(root)) {
            continue;
        }
        const rootInfo = await stat(root);
        const entries = rootInfo.isDirectory()
            ? (await fg("**/*", {
                cwd: root,
                absolute: true,
                onlyFiles: true,
                dot: true,
                followSymbolicLinks: false,
                ignore: ["**/.git/**", "**/node_modules/**", "**/.kb/**", "**/.mimir/**"],
                objectMode: true,
                stats: true,
                unique: true,
            }))
            : [{ path: root, stats: { size: rootInfo.size, mtimeMs: rootInfo.mtimeMs } }];
        for (const entry of entries) {
            const absolutePath = path.isAbsolute(entry.path) ? entry.path : path.resolve(root, entry.path);
            const relativePath = path.relative(config.projectRoot, absolutePath);
            if (GENERATED_SOURCE_READMES.has(relativePath)) {
                continue;
            }
            discoveredFiles += 1;
            const extension = path.extname(absolutePath).toLowerCase();
            const info = entry.stats ?? (await stat(absolutePath));
            const source = rootInfo.isDirectory()
                ? path.relative(root, absolutePath) || path.basename(absolutePath)
                : relativePath || path.basename(absolutePath);
            const skipped = skippedSourceFile(absolutePath, relativePath, source, extension, info.size);
            if (skipped) {
                skippedFiles.set(absolutePath, skipped);
                continue;
            }
            if (!isSupportedSourceFile(absolutePath, extension, config)) {
                const normalizedExtension = extension || NO_EXTENSION;
                skippedFiles.set(absolutePath, {
                    relativePath,
                    source,
                    extension: normalizedExtension,
                    bytes: info.size,
                    reason: "unsupported-extension",
                    recommendation: skippedRecommendation("unsupported-extension", normalizedExtension),
                });
                continue;
            }
            if (info.size > config.maxFileBytes) {
                const normalizedExtension = extension || NO_EXTENSION;
                skippedFiles.set(absolutePath, {
                    relativePath,
                    source,
                    extension: normalizedExtension,
                    bytes: info.size,
                    reason: "oversized",
                    recommendation: skippedRecommendation("oversized", normalizedExtension),
                });
                continue;
            }
            const buffer = await readFile(absolutePath);
            files.set(absolutePath, {
                absolutePath,
                relativePath,
                source,
                extension,
                bytes: info.size,
                mtimeMs: info.mtimeMs,
                checksum: createHash("sha256").update(buffer).digest("hex"),
            });
        }
    }
    return {
        discoveredFiles,
        supportedFiles: [...files.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
        skippedFiles: [...skippedFiles.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    };
}
export function supportedExtensions(config) {
    return new Set([
        ...DEFAULT_SUPPORTED_EXTENSIONS,
        ...(config.imageOcrCommand.length > 0 ? OCR_IMAGE_EXTENSIONS : []),
        ...(config.legacyWordCommand.length > 0 ? LEGACY_WORD_EXTENSIONS : []),
        ...config.includeExtensions,
    ]);
}
function isSupportedSourceFile(absolutePath, extension, config) {
    if (supportedExtensions(config).has(extension)) {
        return true;
    }
    return DEFAULT_SUPPORTED_FILE_NAMES.has(path.basename(absolutePath).toLowerCase());
}
export function summarizeUnsupportedExtensions(skippedFiles) {
    const counts = new Map();
    for (const file of skippedFiles) {
        if (file.reason !== "unsupported-extension") {
            continue;
        }
        counts.set(file.extension, (counts.get(file.extension) ?? 0) + 1);
    }
    return [...counts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([extension, count]) => ({ extension, count }));
}
async function sourceRoots(config) {
    const roots = [config.rawDir];
    if (!existsSync(config.sourcesFile)) {
        return roots;
    }
    const content = await readFile(config.sourcesFile, "utf8");
    for (const line of content.split(/\r?\n/u)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
            continue;
        }
        roots.push(path.isAbsolute(trimmed) ? trimmed : path.resolve(config.projectRoot, trimmed));
    }
    return roots;
}
function skippedSourceFile(absolutePath, relativePath, source, extension, bytes) {
    const baseName = path.basename(absolutePath).toLowerCase();
    if (!SENSITIVE_FILE_NAMES.has(baseName) && !SENSITIVE_EXTENSIONS.has(extension)) {
        return null;
    }
    return {
        relativePath,
        source,
        extension: extension || NO_EXTENSION,
        bytes,
        reason: "sensitive-name",
        recommendation: skippedRecommendation("sensitive-name", extension || NO_EXTENSION),
    };
}
function skippedRecommendation(reason, extension) {
    if (reason === "sensitive-name") {
        return "Review manually; secret-like files are skipped to avoid indexing credentials or private keys.";
    }
    if (reason === "oversized") {
        return "Split, compress, or raise maxFileBytes only after confirming the file is safe and useful.";
    }
    if (OCR_IMAGE_EXTENSIONS.has(extension)) {
        return "Configure imageOcrCommand for local image OCR, save extracted text as a supported text file, or convert to an OCRed PDF before ingesting.";
    }
    if (LEGACY_WORD_EXTENSIONS.has(extension)) {
        return "Configure legacyWordCommand for local legacy Word extraction, or convert to DOCX, PDF, HTML, or text before ingesting.";
    }
    if (LEGACY_EXCEL_EXTENSIONS.has(extension)) {
        return "Convert legacy XLS workbooks to XLSX, CSV, PDF, HTML, or text before ingesting.";
    }
    if (TRANSCRIPTION_EXTENSIONS.has(extension)) {
        return "Transcribe to text, VTT, or SRT before ingesting.";
    }
    return "Convert to a supported text, PDF, Office, OpenDocument, EPUB, or HTML format; use includeExtensions only for UTF-8 text files.";
}
//# sourceMappingURL=files.js.map
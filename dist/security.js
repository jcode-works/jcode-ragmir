import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.js";
import { classifyHost } from "./network.js";
export async function securityAudit(cwd = process.cwd()) {
    const config = await loadConfig(cwd);
    const gitignore = await readGitignore(config.projectRoot);
    const network = classifyHost(config.ollamaHost);
    const warnings = [];
    const kbIgnored = hasGitignoreEntry(gitignore, ".kb/");
    const mimirIgnored = hasGitignoreEntry(gitignore, ".mimir/");
    const privateIgnored = hasGitignoreEntry(gitignore, "private/**");
    if (config.networkPolicy === "allow-any") {
        warnings.push("networkPolicy is allow-any; document text can be sent to a remote Ollama host.");
    }
    if (config.networkPolicy === "local-only" && network.kind !== "loopback") {
        warnings.push("networkPolicy is local-only but ollamaHost is not loopback.");
    }
    if (!config.redaction.enabled) {
        warnings.push("Redaction is disabled; secrets and identifiers may be embedded in the index.");
    }
    if (!kbIgnored) {
        warnings.push(".kb/ is not ignored by Git.");
    }
    if (!mimirIgnored) {
        warnings.push(".mimir/ is not ignored by Git.");
    }
    if (!privateIgnored) {
        warnings.push("private/** is not ignored by Git.");
    }
    return {
        projectRoot: config.projectRoot,
        zeroTelemetry: true,
        network: {
            policy: config.networkPolicy,
            ollamaHost: config.ollamaHost,
            host: network.host,
            classification: network.kind,
        },
        redaction: {
            enabled: config.redaction.enabled,
            builtIn: config.redaction.builtIn,
            customPatterns: config.redaction.patterns.map((pattern) => pattern.name),
        },
        accessLog: {
            enabled: config.accessLog,
            path: config.accessLogPath,
            storesRawQueries: false,
        },
        storage: {
            path: config.storageDir,
            gitIgnored: kbIgnored,
            encryptedAtRest: "external-required",
        },
        mcp: {
            maxTopK: config.mcpMaxTopK,
            destructiveToolsExposed: false,
        },
        gitignore: {
            kbIgnored,
            mimirIgnored,
            privateIgnored,
        },
        recommendations: [
            "Run Mimir inside an encrypted disk, VM, or container volume for at-rest encryption.",
            "Use npm provenance, release checksums, and the generated SBOM for release verification.",
            "Use one repository checkout per trust boundary; Mimir does not implement multi-user RBAC.",
        ],
        warnings,
    };
}
async function readGitignore(projectRoot) {
    const gitignorePath = path.join(projectRoot, ".gitignore");
    if (!existsSync(gitignorePath)) {
        return new Set();
    }
    return new Set((await readFile(gitignorePath, "utf8"))
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean));
}
function hasGitignoreEntry(lines, entry) {
    return lines.has(entry);
}
//# sourceMappingURL=security.js.map
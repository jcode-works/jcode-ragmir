import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { audit } from "./ingest.js";
import { ask, search } from "./query.js";
import { securityAudit } from "./security.js";
import { countRows } from "./store.js";
import { VERSION } from "./version.js";
export async function serveMcp(cwd = process.cwd()) {
    const server = new McpServer({
        name: "mimir",
        version: VERSION,
    });
    server.registerTool("mimir_status", {
        title: "Mimir Status",
        description: "Show active Mimir configuration and indexed chunk count.",
        inputSchema: z.object({}),
    }, async () => {
        const config = await loadConfig(cwd);
        const chunksIndexed = await countRows(config);
        const output = {
            projectRoot: config.projectRoot,
            rawDir: config.rawDir,
            storageDir: config.storageDir,
            sourcesFile: config.sourcesFile,
            embedModel: config.embedModel,
            llmModel: config.llmModel,
            networkPolicy: config.networkPolicy,
            redactionEnabled: config.redaction.enabled,
            mcpMaxTopK: config.mcpMaxTopK,
            chunksIndexed,
        };
        return textResult(output);
    });
    server.registerTool("mimir_search", {
        title: "Mimir Search",
        description: "Retrieve relevant passages from the local Mimir knowledge base.",
        inputSchema: z.object({
            query: z.string().min(1),
            topK: z.number().int().positive().optional(),
        }),
    }, async ({ query, topK }) => textResult(await search(query, await searchOptions(cwd, topK))));
    server.registerTool("mimir_ask", {
        title: "Mimir Ask",
        description: "Answer a question using local retrieved passages and the configured Ollama model.",
        inputSchema: z.object({
            query: z.string().min(1),
            topK: z.number().int().positive().optional(),
        }),
    }, async ({ query, topK }) => textResult(await ask(query, await searchOptions(cwd, topK))));
    server.registerTool("mimir_audit", {
        title: "Mimir Audit",
        description: "Compare supported source files on disk with the current vector index.",
        inputSchema: z.object({}),
    }, async () => textResult(await audit(cwd)));
    server.registerTool("mimir_security_audit", {
        title: "Mimir Security Audit",
        description: "Show local privacy, network, redaction, MCP, and gitignore posture.",
        inputSchema: z.object({}),
    }, async () => textResult(await securityAudit(cwd)));
    await server.connect(new StdioServerTransport());
}
function textResult(value) {
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(value, null, 2),
            },
        ],
    };
}
async function searchOptions(cwd, topK) {
    const config = await loadConfig(cwd);
    const boundedTopK = Math.min(topK ?? config.topK, config.mcpMaxTopK);
    return { cwd, topK: boundedTopK };
}
//# sourceMappingURL=mcp.js.map
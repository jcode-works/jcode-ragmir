import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    maxWorkers: 4,
    // MCP servers read the agent's workspace from these; tests run inside agent shells too.
    env: { CLAUDE_PROJECT_DIR: "", RAGMIR_CLIENT_CWD: "" },
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/test-support/**", "src/cli.ts"],
      thresholds: {
        statements: 85,
        branches: 77,
        functions: 90,
        lines: 85,
        "src/ingest.ts": {
          statements: 90,
          branches: 80,
          functions: 90,
          lines: 90,
        },
        "src/query.ts": {
          statements: 90,
          branches: 80,
          functions: 90,
          lines: 90,
        },
      },
    },
  },
})

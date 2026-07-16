import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/cli.ts"],
      thresholds: {
        statements: 78,
        branches: 70,
        functions: 78,
        lines: 80,
      },
    },
  },
})

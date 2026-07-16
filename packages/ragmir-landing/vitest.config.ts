import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "src/components/hero-demo-script.ts",
        "src/i18n/**/*.ts",
        "src/lib/**/*.ts",
        "src/services/**/*.ts",
      ],
      exclude: ["src/**/*.test.ts"],
      thresholds: {
        statements: 90,
        branches: 80,
        functions: 90,
        lines: 90,
      },
    },
  },
})

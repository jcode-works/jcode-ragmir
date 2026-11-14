#!/usr/bin/env node
// Starts the Ragmir MCP server for the project the agent has open: Claude Code passes it as
// CLAUDE_PROJECT_DIR, and Gemini CLI or Qwen Code start this script in the workspace folder.
//
// The server always comes from the pinned npm release below, run from the plugin's data folder,
// so opening a repository never executes code that repository ships. The project is passed as
// RAGMIR_PROJECT_ROOT: the server only reads its Ragmir configuration and local index.
import { spawn } from "node:child_process"
import { mkdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const RAGMIR_VERSION = "6.5.2"

const projectRoot = path.resolve(
  process.env.RAGMIR_PROJECT_ROOT || process.env.CLAUDE_PROJECT_DIR || process.cwd(),
)
const workDir = process.env.CLAUDE_PLUGIN_DATA || path.join(os.tmpdir(), "ragmir-claude-plugin")
mkdirSync(workDir, { recursive: true })

const isWindows = process.platform === "win32"
const child = spawn(
  isWindows ? "npx.cmd" : "npx",
  ["--yes", `@jcode.labs/ragmir@${RAGMIR_VERSION}`, "serve-mcp"],
  {
    cwd: workDir,
    env: { ...process.env, RAGMIR_PROJECT_ROOT: projectRoot },
    stdio: "inherit",
    // Windows only starts .cmd launchers through a shell; every argument above is a constant.
    shell: isWindows,
  },
)

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    child.kill(signal)
  })
}

child.on("error", (error) => {
  console.error(`Ragmir MCP server could not start: ${error.message}`)
  process.exit(1)
})

child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0))
})

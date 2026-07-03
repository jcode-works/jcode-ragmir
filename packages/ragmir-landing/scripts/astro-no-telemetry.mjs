#!/usr/bin/env node
import { spawn } from "node:child_process"

const args = process.argv.slice(2)

if (args.length === 0) {
  console.error("usage: astro-no-telemetry <astro-command> [...args]")
  process.exitCode = 1
} else {
  const command = process.platform === "win32" ? "astro.cmd" : "astro"
  const child = spawn(command, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      ASTRO_TELEMETRY_DISABLED: "1",
    },
  })

  child.on("error", (error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })

  child.on("close", (code) => {
    process.exitCode = code ?? 1
  })
}

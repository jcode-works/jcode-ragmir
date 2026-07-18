#!/usr/bin/env node
import { runFastCli } from "./cli-fast.js"

try {
  const result = await runFastCli(process.argv.slice(2), process.argv[1])
  if (result.handled) {
    process.exitCode = result.exitCode
  } else {
    await import("./cli.js")
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}

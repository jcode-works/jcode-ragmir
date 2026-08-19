import { readFile } from "node:fs/promises"
import path from "node:path"
import { compareBenchmarkReports } from "./lib/comparison.mjs"

const options = parseArguments(process.argv.slice(2))
if (!options.baseline || !options.current) {
  throw new Error("Usage: compare.mjs --baseline <result.json> --current <result.json>")
}

const invocationRoot = process.env.INIT_CWD ?? process.cwd()
const baselinePath = path.resolve(invocationRoot, options.baseline)
const currentPath = path.resolve(invocationRoot, options.current)
const baseline = JSON.parse(await readFile(baselinePath, "utf8"))
const current = JSON.parse(await readFile(currentPath, "utf8"))
const result = compareBenchmarkReports(baseline, current, {
  allowCrossMachine: options.allowCrossMachine === true,
})

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
if (result.status !== "pass") {
  process.exitCode = result.status === "fail" ? 1 : 2
}

function parseArguments(values) {
  const parsed = {}
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (!value?.startsWith("--")) {
      continue
    }
    const key = value.slice(2).replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase())
    const next = values[index + 1]
    if (next === undefined || next.startsWith("--")) {
      parsed[key] = true
    } else {
      parsed[key] = next
      index += 1
    }
  }
  return parsed
}

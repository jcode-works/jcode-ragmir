import { spawnSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const packageDirs = ["packages/mimir-tts", "packages/mimir-core"]
const checkOnly = process.argv.includes("--check")

for (const directory of packageDirs) {
  const manifest = JSON.parse(
    await readFile(path.join(repoRoot, directory, "package.json"), "utf8"),
  )
  if (manifest.publishConfig?.access !== "public") {
    throw new Error(`${manifest.name} must publish with public access`)
  }
}

if (checkOnly) {
  console.log("Semantic release verify check passed.")
} else if (process.env.GITHUB_ACTIONS === "true") {
  if (!process.env.NODE_AUTH_TOKEN) {
    throw new Error("NODE_AUTH_TOKEN is required before semantic-release can create a tag")
  }
  run("npm", ["whoami", "--registry=https://registry.npmjs.org"])
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "inherit",
  })
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`)
  }
}

import { spawnSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const packageDirs = ["packages/mimir-tts", "packages/mimir-core"]
const version = parseVersionArg(process.argv.slice(2))
const checkOnly = process.argv.includes("--check")

for (const directory of packageDirs) {
  const manifest = JSON.parse(
    await readFile(path.join(repoRoot, directory, "package.json"), "utf8"),
  )
  if (manifest.version !== version && !checkOnly) {
    throw new Error(`${manifest.name} is ${manifest.version}, expected ${version}`)
  }
  if (manifest.publishConfig?.access !== "public") {
    throw new Error(`${manifest.name} must publish with public access`)
  }
}

if (checkOnly) {
  console.log(`Semantic release publish check passed for ${version}`)
} else {
  if (!process.env.NODE_AUTH_TOKEN) {
    throw new Error("NODE_AUTH_TOKEN is required for npm publish")
  }
  for (const directory of packageDirs) {
    run("pnpm", [
      "--dir",
      directory,
      "publish",
      "--access",
      "public",
      "--provenance",
      "--no-git-checks",
    ])
  }
}

function parseVersionArg(args) {
  const candidate = args.find((arg) => !arg.startsWith("--"))
  if (!candidate || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(candidate)) {
    throw new Error("Usage: node scripts/semantic-release-publish.mjs [--check] <semver>")
  }
  return candidate
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

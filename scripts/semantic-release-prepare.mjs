import { spawnSync } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const packageDirs = ["packages/mimir-tts", "packages/mimir-core"]
const version = parseVersionArg(process.argv.slice(2))
const checkOnly = process.argv.includes("--check")

for (const directory of packageDirs) {
  const manifestPath = path.join(repoRoot, directory, "package.json")
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  if (typeof manifest.name !== "string" || !manifest.name.startsWith("@jcode.labs/mimir")) {
    throw new Error(`Unexpected publish package manifest at ${directory}`)
  }
  if (!checkOnly) {
    manifest.version = version
    await writeJson(manifestPath, manifest)
  }
}

const versionSourcePath = path.join(repoRoot, "packages/mimir-core/src/version.ts")
if (!checkOnly) {
  await writeFile(versionSourcePath, `export const VERSION = ${JSON.stringify(version)}\n`, "utf8")
}

if (checkOnly) {
  console.log(`Semantic release prepare check passed for ${version}`)
} else {
  run("pnpm", ["--filter", "@jcode.labs/mimir", "build"])
  run("pnpm", ["package:check"])
  run("pnpm", ["release:artifacts"])
}

function parseVersionArg(args) {
  const candidate = args.find((arg) => !arg.startsWith("--"))
  if (!candidate || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(candidate)) {
    throw new Error("Usage: node scripts/semantic-release-prepare.mjs [--check] <semver>")
  }
  return candidate
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
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

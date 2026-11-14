import { spawnSync } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const packageDirs = ["packages/ragmir-core"]
const version = parseVersionArg(process.argv.slice(2))
const checkOnly = process.argv.includes("--check")

for (const directory of packageDirs) {
  const manifestPath = path.join(repoRoot, directory, "package.json")
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  if (typeof manifest.name !== "string" || !manifest.name.startsWith("@jcode.labs/ragmir")) {
    throw new Error(`Unexpected publish package manifest at ${directory}`)
  }
  if (!checkOnly) {
    manifest.version = version
    await writeJson(manifestPath, manifest)
  }
}

const versionSourcePath = path.join(repoRoot, "packages/ragmir-core/src/version.ts")
if (!checkOnly) {
  await writeFile(versionSourcePath, `export const VERSION = ${JSON.stringify(version)}\n`, "utf8")
}

// The MCP Registry entry must name the npm version it installs, and the registry checks that
// package's `mcpName`, so both stay aligned with the published Core manifest.
const serverManifestPath = path.join(repoRoot, "server.json")
const serverManifest = JSON.parse(await readFile(serverManifestPath, "utf8"))
const coreManifest = JSON.parse(
  await readFile(path.join(repoRoot, "packages/ragmir-core/package.json"), "utf8"),
)
const registryPackages = serverManifest.packages ?? []
if (
  serverManifest.name !== coreManifest.mcpName ||
  registryPackages.length !== 1 ||
  registryPackages[0].identifier !== coreManifest.name
) {
  throw new Error("server.json must describe the Core npm package and match its mcpName")
}
if (!checkOnly) {
  serverManifest.version = version
  registryPackages[0].version = version
  await writeJson(serverManifestPath, serverManifest)
}

if (checkOnly) {
  console.log(`Semantic release prepare check passed for ${version}`)
} else {
  for (const directory of packageDirs) {
    run("pnpm", ["--dir", directory, "build"])
  }
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

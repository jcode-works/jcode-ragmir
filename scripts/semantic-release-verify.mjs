import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const packageDirs = ["packages/ragmir-core"]
const optionalCorePackages = ["@huggingface/transformers"]
const checkOnly = process.argv.includes("--check")
let coreManifest

for (const directory of packageDirs) {
  const manifest = JSON.parse(
    await readFile(path.join(repoRoot, directory, "package.json"), "utf8"),
  )
  if (manifest.publishConfig?.access !== "public") {
    throw new Error(`${manifest.name} must publish with public access`)
  }
  if (directory === "packages/ragmir-core") {
    coreManifest = manifest
  }
}

for (const packageName of optionalCorePackages) {
  if (coreManifest?.dependencies?.[packageName] !== undefined) {
    throw new Error(`${packageName} must not be installed as a Core dependency`)
  }
  if (
    typeof coreManifest?.peerDependencies?.[packageName] !== "string" ||
    coreManifest.peerDependenciesMeta?.[packageName]?.optional !== true
  ) {
    throw new Error(`${packageName} must remain an optional Core peer dependency`)
  }
}

if (checkOnly) {
  console.log("Semantic release verify check passed.")
} else if (process.env.GITHUB_ACTIONS === "true") {
  // Trusted publishing needs the job's OIDC request credentials before a tag is created.
  if (!process.env.ACTIONS_ID_TOKEN_REQUEST_URL || !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    throw new Error(
      "npm trusted publishing requires the release job's id-token: write permission before semantic-release can create a tag",
    )
  }
}

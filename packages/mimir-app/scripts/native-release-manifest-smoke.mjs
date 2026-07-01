import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const CHECKSUMS_SCRIPT = join(SCRIPT_DIR, "native-checksums.mjs")
const MANIFEST_SCRIPT = join(SCRIPT_DIR, "native-release-manifest.mjs")
const tempDir = await mkdtemp(join(tmpdir(), "mimir-native-release-manifest-smoke-"))
const artifactsDir = join(tempDir, "bundle")
const manifestPath = join(artifactsDir, "mimir-app-release.json")

try {
  await mkdir(artifactsDir, { recursive: true })
  await writeFile(join(artifactsDir, "mimir_0.0.0_amd64.deb"), "synthetic deb\n", "utf8")
  await writeFile(join(artifactsDir, "Mimir_0.0.0.AppImage"), "synthetic appimage\n", "utf8")

  runNode([CHECKSUMS_SCRIPT, "--artifacts-dir", artifactsDir])
  assertFails(
    [
      MANIFEST_SCRIPT,
      "--artifacts-dir",
      artifactsDir,
      "--target",
      "linux",
      "--base-url",
      "http://downloads.example.invalid/mimir/linux",
    ],
    "--base-url must use HTTPS.",
  )
  const result = runNode([
    MANIFEST_SCRIPT,
    "--artifacts-dir",
    artifactsDir,
    "--target",
    "linux",
    "--out",
    manifestPath,
    "--base-url",
    "https://downloads.example.invalid/mimir/linux",
    "--generated-at",
    "2026-06-30T00:00:00.000Z",
    "--json",
  ])

  const output = JSON.parse(result.stdout)
  const manifest = output.manifest
  assertEqual(output.outputPath, manifestPath, "outputPath")
  assertEqual(manifest.schemaVersion, 1, "schemaVersion")
  assertEqual(manifest.product, "Mimir", "product")
  assertEqual(manifest.packageName, "@jcode.labs/mimir-app", "packageName")
  assertEqual(manifest.target, "linux", "target")
  assertEqual(manifest.generatedAt, "2026-06-30T00:00:00.000Z", "generatedAt")
  assertEqual(manifest.files.length, 2, "files length")

  for (const entry of manifest.files) {
    const content = await readFile(join(artifactsDir, entry.file))
    const sha256 = createHash("sha256").update(content).digest("hex")
    assertEqual(entry.sha256, sha256, `sha256 for ${entry.file}`)
    assertEqual(entry.sizeBytes, content.byteLength, `sizeBytes for ${entry.file}`)
    assertEqual(
      entry.downloadUrl,
      `https://downloads.example.invalid/mimir/linux/${entry.file}`,
      `downloadUrl for ${entry.file}`,
    )
  }

  const writtenManifest = JSON.parse(await readFile(manifestPath, "utf8"))
  assertEqual(writtenManifest.files.length, 2, "written files length")

  console.log("Native release manifest smoke passed.")
} finally {
  await rm(tempDir, { recursive: true, force: true })
}

function runNode(args) {
  const result = spawnSync(process.execPath, args, { encoding: "utf8", shell: false })
  if (result.status !== 0) {
    throw new Error(
      `command failed: node ${args.join(" ")}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    )
  }
  return result
}

function assertFails(args, expectedStderr) {
  const result = spawnSync(process.execPath, args, { encoding: "utf8", shell: false })
  if (result.status === 0) {
    throw new Error(`command unexpectedly passed: node ${args.join(" ")}`)
  }
  if (!result.stderr.includes(expectedStderr)) {
    throw new Error(
      `expected stderr to include ${expectedStderr}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    )
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`)
  }
}

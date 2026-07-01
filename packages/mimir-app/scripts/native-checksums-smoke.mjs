import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const CHECKSUMS_SCRIPT = join(SCRIPT_DIR, "native-checksums.mjs")
const tempDir = await mkdtemp(join(tmpdir(), "mimir-native-checksums-smoke-"))
const artifactsDir = join(tempDir, "bundle")
const nestedDir = join(artifactsDir, "app")
const manifestPath = join(artifactsDir, "SHA256SUMS")

try {
  await mkdir(nestedDir, { recursive: true })
  await writeFile(join(artifactsDir, "mimir_0.0.0_amd64.deb"), "synthetic deb\n", "utf8")
  await writeFile(join(artifactsDir, "Mimir_0.0.0.AppImage"), "synthetic appimage\n", "utf8")
  await writeFile(join(nestedDir, "mimir"), "synthetic binary\n", "utf8")
  await writeFile(manifestPath, "stale manifest should be replaced\n", "utf8")

  const result = spawnSync(
    process.execPath,
    [CHECKSUMS_SCRIPT, "--artifacts-dir", artifactsDir, "--out", manifestPath, "--json"],
    { encoding: "utf8", shell: false },
  )

  if (result.status !== 0) {
    throw new Error(
      `native checksums smoke failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    )
  }

  const output = JSON.parse(result.stdout)
  assertEqual(output.artifactsDir, artifactsDir, "artifactsDir")
  assertEqual(output.outputPath, manifestPath, "outputPath")

  const files = output.files.map((entry) => entry.file)
  assertEqual(
    JSON.stringify(files),
    JSON.stringify(["app/mimir", "mimir_0.0.0_amd64.deb", "Mimir_0.0.0.AppImage"]),
    "sorted manifest files",
  )
  assertEqual(files.includes("SHA256SUMS"), false, "manifest should not checksum itself")

  const manifest = await readFile(manifestPath, "utf8")
  for (const file of files) {
    const content = await readFile(join(artifactsDir, file))
    const sha256 = createHash("sha256").update(content).digest("hex")
    assertIncludes(manifest, `${sha256}  ${file}`, `manifest entry for ${file}`)
  }

  console.log("Native checksum smoke passed.")
} finally {
  await rm(tempDir, { recursive: true, force: true })
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`)
  }
}

function assertIncludes(actual, expected, label) {
  if (!actual.includes(expected)) {
    throw new Error(`${label}: expected ${expected} in ${actual}`)
  }
}

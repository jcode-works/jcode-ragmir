import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const CHECKSUMS_SCRIPT = join(SCRIPT_DIR, "native-checksums.mjs")
const MANIFEST_SCRIPT = join(SCRIPT_DIR, "native-release-manifest.mjs")
const VERIFY_SCRIPT = join(SCRIPT_DIR, "native-bundle-verify.mjs")
const tempDir = await mkdtemp(join(tmpdir(), "mimir-native-bundle-verify-smoke-"))

try {
  for (const target of ["linux", "macos", "windows", "android"]) {
    const artifactsDir = join(tempDir, target)
    await mkdir(artifactsDir, { recursive: true })
    await writeTargetArtifacts(artifactsDir, target)
    runNode([CHECKSUMS_SCRIPT, "--artifacts-dir", artifactsDir])
    runNode([MANIFEST_SCRIPT, "--artifacts-dir", artifactsDir, "--target", target])

    const result = runNode([
      VERIFY_SCRIPT,
      "--artifacts-dir",
      artifactsDir,
      "--target",
      target,
      "--json",
    ])
    const output = JSON.parse(result.stdout)
    assertEqual(output.ok, true, `${target} verification`)
  }

  const incompleteLinuxDir = join(tempDir, "incomplete-linux")
  await mkdir(incompleteLinuxDir, { recursive: true })
  await writeFile(join(incompleteLinuxDir, "Mimir_0.0.0.AppImage"), "synthetic appimage\n", "utf8")
  runNode([CHECKSUMS_SCRIPT, "--artifacts-dir", incompleteLinuxDir])
  runNode([MANIFEST_SCRIPT, "--artifacts-dir", incompleteLinuxDir, "--target", "linux"])
  assertFails(
    [VERIFY_SCRIPT, "--artifacts-dir", incompleteLinuxDir, "--target", "linux", "--json"],
    "Linux Debian package",
  )

  console.log("Native bundle verification smoke passed.")
} finally {
  await rm(tempDir, { recursive: true, force: true })
}

async function writeTargetArtifacts(artifactsDir, target) {
  if (target === "linux") {
    await writeFile(join(artifactsDir, "Mimir_0.0.0.AppImage"), "synthetic appimage\n", "utf8")
    await writeFile(join(artifactsDir, "mimir_0.0.0_amd64.deb"), "synthetic deb\n", "utf8")
    return
  }
  if (target === "macos") {
    await mkdir(join(artifactsDir, "Mimir.app", "Contents"), { recursive: true })
    await writeFile(join(artifactsDir, "Mimir_0.0.0.dmg"), "synthetic dmg\n", "utf8")
    await writeFile(
      join(artifactsDir, "Mimir.app", "Contents", "Info.plist"),
      "synthetic plist\n",
      "utf8",
    )
    return
  }
  if (target === "windows") {
    await writeFile(join(artifactsDir, "Mimir_0.0.0_x64-setup.exe"), "synthetic exe\n", "utf8")
    await writeFile(join(artifactsDir, "Mimir_0.0.0_x64_en-US.msi"), "synthetic msi\n", "utf8")
    return
  }
  await writeFile(join(artifactsDir, "mimir-universal-release.apk"), "synthetic apk\n", "utf8")
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

function assertFails(args, expectedOutput) {
  const result = spawnSync(process.execPath, args, { encoding: "utf8", shell: false })
  if (result.status === 0) {
    throw new Error(`command unexpectedly passed: node ${args.join(" ")}`)
  }
  const output = `${result.stdout}\n${result.stderr}`
  if (!output.includes(expectedOutput)) {
    throw new Error(`expected output to include ${expectedOutput}\n${output}`)
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`)
  }
}

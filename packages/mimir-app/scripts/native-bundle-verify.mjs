import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

const VALID_TARGETS = new Set(["macos", "windows", "linux", "android"])
const args = parseArgs(process.argv.slice(2))
const target = requiredTarget(args.target)
const artifactsDir = path.resolve(args["artifacts-dir"] ?? "src-tauri/target/release/bundle")
const checksumsPath = path.resolve(args.checksums ?? path.join(artifactsDir, "SHA256SUMS"))
const manifestPath = path.resolve(
  args.manifest ?? path.join(artifactsDir, "mimir-app-release.json"),
)
const checksumEntries = await readChecksums(checksumsPath)
const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
const files = await listFiles(artifactsDir)
const report = await verifyBundle({
  artifactsDir,
  checksumEntries,
  files,
  manifest,
  target,
})

if (args.json) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`Mimir native bundle verification: ${report.ok ? "ok" : "failed"}`)
  for (const check of report.checks) {
    console.log(`${check.ok ? "ok" : "missing"} ${check.label}: ${check.detail}`)
  }
}

if (!report.ok) {
  process.exitCode = 1
}

async function verifyBundle({ artifactsDir, checksumEntries, files, manifest, target }) {
  const checksumMap = new Map(checksumEntries.map((entry) => [entry.file, entry.sha256]))
  const manifestFiles = Array.isArray(manifest.files) ? manifest.files : []
  const manifestMap = new Map(manifestFiles.map((entry) => [entry.file, entry]))
  const artifactFiles = files.filter(
    (file) => file !== "SHA256SUMS" && file !== "mimir-app-release.json",
  )
  const checks = [
    {
      label: "target",
      ok: manifest.target === target,
      detail: manifest.target === target ? target : `manifest target is ${manifest.target}`,
    },
    {
      label: "checksum entries",
      ok: artifactFiles.length > 0 && sameSet(artifactFiles, [...checksumMap.keys()]),
      detail: `${checksumMap.size} checksum entries for ${artifactFiles.length} artifact files`,
    },
    {
      label: "manifest entries",
      ok: artifactFiles.length > 0 && sameSet(artifactFiles, [...manifestMap.keys()]),
      detail: `${manifestMap.size} manifest entries for ${artifactFiles.length} artifact files`,
    },
    ...targetChecks(target, artifactFiles),
  ]

  for (const file of artifactFiles) {
    const content = await readFile(path.join(artifactsDir, file))
    const sha256 = createHash("sha256").update(content).digest("hex")
    const manifestEntry = manifestMap.get(file)
    checks.push({
      label: `sha256 ${file}`,
      ok: checksumMap.get(file) === sha256 && manifestEntry?.sha256 === sha256,
      detail: "checksum and manifest must match file content",
    })
    checks.push({
      label: `size ${file}`,
      ok: manifestEntry?.sizeBytes === content.byteLength,
      detail: `manifest size=${manifestEntry?.sizeBytes ?? "missing"} actual=${content.byteLength}`,
    })
    checks.push({
      label: `download URL ${file}`,
      ok: validOptionalDownloadUrl(manifestEntry?.downloadUrl),
      detail: manifestEntry?.downloadUrl ? "HTTPS download URL" : "no download URL",
    })
  }

  return {
    ok: checks.every((check) => check.ok),
    target,
    artifactsDir,
    checks,
  }
}

function targetChecks(target, files) {
  if (target === "linux") {
    return [
      expectedFile(files, ".AppImage", "Linux AppImage"),
      expectedFile(files, ".deb", "Linux Debian package"),
    ]
  }
  if (target === "macos") {
    return [
      expectedFile(files, ".dmg", "macOS disk image"),
      expectedPattern(files, /\.app\/Contents\/Info\.plist$/u, "macOS app bundle"),
    ]
  }
  if (target === "windows") {
    return [
      expectedFile(files, ".exe", "Windows NSIS installer"),
      expectedFile(files, ".msi", "Windows MSI installer"),
    ]
  }
  return [expectedFile(files, ".apk", "Android APK")]
}

function expectedFile(files, suffix, label) {
  return {
    label,
    ok: files.some((file) => file.endsWith(suffix)),
    detail: `expected at least one ${suffix} artifact`,
  }
}

function expectedPattern(files, pattern, label) {
  return {
    label,
    ok: files.some((file) => pattern.test(file)),
    detail: `expected a file matching ${pattern}`,
  }
}

function validOptionalDownloadUrl(value) {
  if (typeof value === "undefined") {
    return true
  }
  if (typeof value !== "string") {
    return false
  }
  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
}

async function readChecksums(filePath) {
  const lines = (await readFile(filePath, "utf8")).split(/\r?\n/u)
  const entries = []
  for (const line of lines) {
    if (line.trim() === "") continue
    const match = line.match(/^([a-f0-9]{64})\s{2}(.+)$/u)
    if (!match) {
      throw new Error(`Invalid checksum line: ${line}`)
    }
    const [, sha256, file] = match
    if (path.isAbsolute(file) || file.split("/").includes("..")) {
      throw new Error(`Checksum path must be relative and stay inside artifacts dir: ${file}`)
    }
    entries.push({ file, sha256 })
  }
  return entries
}

async function listFiles(root, base = root) {
  const children = await readdir(root, { withFileTypes: true })
  const files = []

  for (const child of children) {
    const filePath = path.join(root, child.name)
    if (child.isDirectory()) {
      files.push(...(await listFiles(filePath, base)))
      continue
    }
    if (child.isFile()) {
      files.push(path.relative(base, filePath).split(path.sep).join("/"))
    }
  }

  return files.sort()
}

function sameSet(left, right) {
  if (left.length !== right.length) {
    return false
  }
  const rightSet = new Set(right)
  return left.every((entry) => rightSet.has(entry))
}

function requiredTarget(value) {
  if (!VALID_TARGETS.has(value)) {
    throw new Error(`--target must be one of ${Array.from(VALID_TARGETS).join(", ")}.`)
  }
  return value
}

function parseArgs(values) {
  const parsed = {}
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === "--") continue
    if (!value?.startsWith("--")) continue
    const key = value.slice(2)
    const next = values[index + 1]
    if (!next || next.startsWith("--")) {
      parsed[key] = true
      continue
    }
    parsed[key] = next
    index += 1
  }
  return parsed
}

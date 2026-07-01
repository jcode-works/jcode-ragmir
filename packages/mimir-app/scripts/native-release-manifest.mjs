import { readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"

const VALID_TARGETS = new Set(["macos", "windows", "linux", "android"])
const args = parseArgs(process.argv.slice(2))
const artifactsDir = path.resolve(args["artifacts-dir"] ?? "src-tauri/target/release/bundle")
const checksumsPath = path.resolve(args.checksums ?? path.join(artifactsDir, "SHA256SUMS"))
const outputPath = path.resolve(args.out ?? path.join(artifactsDir, "mimir-app-release.json"))
const target = requiredTarget(args.target)
const generatedAt = args["generated-at"] ?? new Date().toISOString()
const baseUrl = optionalHttpsBaseUrl(args["base-url"])
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
const entries = await manifestEntries(artifactsDir, checksumsPath, outputPath, baseUrl)

if (entries.length === 0) {
  throw new Error(`No checksum entries found in ${checksumsPath}.`)
}

const manifest = {
  schemaVersion: 1,
  product: "Mimir",
  packageName: packageJson.name,
  version: packageJson.version,
  target,
  generatedAt,
  files: entries,
}

await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")

if (args.json) {
  console.log(JSON.stringify({ outputPath, manifest }, null, 2))
} else {
  console.log(`Wrote ${path.relative(process.cwd(), outputPath) || outputPath}`)
}

async function manifestEntries(root, checksums, output, baseUrl) {
  const lines = (await readFile(checksums, "utf8")).split(/\r?\n/u)
  const outputRelative = path.relative(root, output).split(path.sep).join("/")
  const entries = []

  for (const line of lines) {
    if (line.trim() === "") continue
    const match = line.match(/^([a-f0-9]{64})\s{2}(.+)$/u)
    if (!match) {
      throw new Error(`Invalid checksum line: ${line}`)
    }
    const [, sha256, file] = match
    if (file === outputRelative || file === "mimir-app-release.json") {
      continue
    }
    if (path.isAbsolute(file) || file.split("/").includes("..")) {
      throw new Error(`Checksum path must be relative and stay inside artifacts dir: ${file}`)
    }
    const filePath = path.join(root, file)
    const info = await stat(filePath)
    if (!info.isFile()) {
      throw new Error(`Checksum entry is not a file: ${file}`)
    }
    entries.push(
      appendOptionalUrl(
        {
          file,
          sizeBytes: info.size,
          sha256,
        },
        baseUrl,
      ),
    )
  }

  return entries.sort((a, b) => a.file.localeCompare(b.file))
}

function appendOptionalUrl(entry, baseUrl) {
  if (!baseUrl) {
    return entry
  }
  return {
    ...entry,
    downloadUrl: `${baseUrl.replace(/\/+$/u, "")}/${entry.file
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/")}`,
  }
}

function optionalHttpsBaseUrl(value) {
  if (!value) {
    return null
  }
  const parsed = new URL(value)
  if (parsed.protocol !== "https:") {
    throw new Error("--base-url must use HTTPS.")
  }
  return parsed.toString().replace(/\/+$/u, "")
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

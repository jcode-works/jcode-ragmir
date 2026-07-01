import { createHash } from "node:crypto"
import { readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

const args = parseArgs(process.argv.slice(2))
const artifactsDir = path.resolve(args["artifacts-dir"] ?? "src-tauri/target/release/bundle")
const outputPath = path.resolve(args.out ?? path.join(artifactsDir, "SHA256SUMS"))
const entries = await checksumEntries(artifactsDir, outputPath)

if (entries.length === 0) {
  throw new Error(`No files found under ${artifactsDir}.`)
}

const content = `${entries.map((entry) => `${entry.sha256}  ${entry.file}`).join("\n")}\n`
await writeFile(outputPath, content, "utf8")

if (args.json) {
  console.log(
    JSON.stringify(
      {
        artifactsDir,
        outputPath,
        files: entries,
      },
      null,
      2,
    ),
  )
} else {
  console.log(`Wrote ${path.relative(process.cwd(), outputPath) || outputPath}`)
}

async function checksumEntries(root, output) {
  const files = await listFiles(root)
  const outputAbsolute = path.resolve(output)
  const entries = []

  for (const file of files) {
    if (path.resolve(file) === outputAbsolute) {
      continue
    }
    const buffer = await readFile(file)
    entries.push({
      file: path.relative(root, file).split(path.sep).join("/"),
      sha256: createHash("sha256").update(buffer).digest("hex"),
    })
  }

  return entries.sort((a, b) => a.file.localeCompare(b.file))
}

async function listFiles(root) {
  const children = await readdir(root, { withFileTypes: true })
  const files = []

  for (const child of children) {
    const filePath = path.join(root, child.name)
    if (child.isDirectory()) {
      files.push(...(await listFiles(filePath)))
      continue
    }
    if (child.isFile()) {
      files.push(filePath)
    }
  }

  return files
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

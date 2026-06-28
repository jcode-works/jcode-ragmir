import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { ensureMimirGitignore } from "./gitignore.js"

const DEFAULT_CONFIG = {
  rawDir: "private",
  storageDir: ".kb/storage",
  sourcesFile: ".kb/sources.txt",
  accessLogPath: ".kb/access.log",
  tableName: "chunks",
  ollamaHost: "http://localhost:11434",
  networkPolicy: "local-only",
  embedModel: "nomic-embed-text",
  llmModel: "gemma4:latest",
  redaction: {
    enabled: true,
    builtIn: true,
    patterns: [],
  },
  accessLog: true,
  mcpMaxTopK: 10,
  topK: 5,
  chunkSize: 1200,
  chunkOverlap: 150,
}

export async function initProject(cwd = process.cwd()): Promise<string[]> {
  const root = path.resolve(cwd)
  const kbDir = path.join(root, ".kb")
  const privateDir = path.join(root, "private")
  const created: string[] = []

  await mkdir(kbDir, { recursive: true })
  await mkdir(privateDir, { recursive: true })

  const configPath = path.join(kbDir, "config.json")
  if (!existsSync(configPath)) {
    await writeFile(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf8")
    created.push(path.relative(root, configPath))
  }

  const sourcesPath = path.join(kbDir, "sources.txt")
  if (!existsSync(sourcesPath)) {
    await writeFile(
      sourcesPath,
      "# Optional extra source paths, one per line. Relative paths resolve from the project root.\n",
      "utf8",
    )
    created.push(path.relative(root, sourcesPath))
  }

  const readmePath = path.join(privateDir, "README.md")
  if (!existsSync(readmePath)) {
    await writeFile(
      readmePath,
      "# Private documents\n\nPut raw documents to ingest here. Keep this folder ignored by Git.\n",
      "utf8",
    )
    created.push(path.relative(root, readmePath))
  }

  if (await ensureMimirGitignore(root)) {
    created.push(".gitignore")
  }

  return created
}

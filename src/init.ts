import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_CONFIG = {
  rawDir: "private",
  storageDir: ".kb/storage",
  sourcesFile: ".kb/sources.txt",
  tableName: "chunks",
  ollamaHost: "http://localhost:11434",
  embedModel: "nomic-embed-text",
  llmModel: "gemma4:latest",
  topK: 5,
  chunkSize: 1200,
  chunkOverlap: 150,
};

const GITIGNORE_BLOCK = `\n# JCode Knowledge Base\n.kb/storage/\n.kb/cache/\n.kb/*.local.json\nprivate/**\n!private/\n!private/README.md\n!private/**/\n!private/**/.gitkeep\n`;

export async function initProject(cwd = process.cwd()): Promise<string[]> {
  const root = path.resolve(cwd);
  const kbDir = path.join(root, ".kb");
  const privateDir = path.join(root, "private");
  const created: string[] = [];

  await mkdir(kbDir, { recursive: true });
  await mkdir(privateDir, { recursive: true });

  const configPath = path.join(kbDir, "config.json");
  if (!existsSync(configPath)) {
    await writeFile(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf8");
    created.push(path.relative(root, configPath));
  }

  const sourcesPath = path.join(kbDir, "sources.txt");
  if (!existsSync(sourcesPath)) {
    await writeFile(
      sourcesPath,
      "# Optional extra source paths, one per line. Relative paths resolve from the project root.\n",
      "utf8",
    );
    created.push(path.relative(root, sourcesPath));
  }

  const readmePath = path.join(privateDir, "README.md");
  if (!existsSync(readmePath)) {
    await writeFile(
      readmePath,
      "# Private documents\n\nPut raw documents to ingest here. Keep this folder ignored by Git.\n",
      "utf8",
    );
    created.push(path.relative(root, readmePath));
  }

  const gitignorePath = path.join(root, ".gitignore");
  const currentGitignore = existsSync(gitignorePath)
    ? await readFile(gitignorePath, "utf8")
    : "";
  if (!currentGitignore.includes("# JCode Knowledge Base")) {
    await writeFile(gitignorePath, `${currentGitignore.trimEnd()}${GITIGNORE_BLOCK}`, "utf8");
    created.push(path.relative(root, gitignorePath));
  }

  return created;
}

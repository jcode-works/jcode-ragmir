import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { listSourceFiles } from "./files.js"
import { testConfig } from "./test-support/config.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("listSourceFiles", () => {
  it("indexes broad text-like formats and custom extensions while ignoring runtime folders", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-files-"))
    tempDirs.push(root)

    await mkdir(path.join(root, "private", "nested"), { recursive: true })
    await mkdir(path.join(root, "private", ".kb"), { recursive: true })
    await mkdir(path.join(root, "private", ".mimir"), { recursive: true })
    await writeFile(path.join(root, "private", "events.jsonl"), '{"event":"login"}\n', "utf8")
    await writeFile(path.join(root, "private", "schema.sql"), "select 1;\n", "utf8")
    await writeFile(path.join(root, "private", "notes.transcript"), "call notes\n", "utf8")
    await writeFile(path.join(root, "private", "image.png"), "not indexed\n", "utf8")
    await writeFile(path.join(root, "private", ".kb", "index.md"), "ignored\n", "utf8")
    await writeFile(path.join(root, "private", ".mimir", "agent.md"), "ignored\n", "utf8")

    const files = await listSourceFiles(testConfig(root, { includeExtensions: [".transcript"] }))

    expect(files.map((file) => file.relativePath)).toEqual([
      "private/events.jsonl",
      "private/notes.transcript",
      "private/schema.sql",
    ])
  })
})

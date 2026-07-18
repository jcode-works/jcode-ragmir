import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  type DurableWritePhase,
  withDurableWriteFaultForTests,
  writePrivateFileAtomic,
} from "./durable-file.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const directory of tempDirs.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

describe("durable file replacement", () => {
  it.each([
    { phase: "before-write" as const, expected: "old" },
    { phase: "before-sync" as const, expected: "old" },
    { phase: "before-rename" as const, expected: "old" },
    { phase: "after-rename" as const, expected: "new" },
  ])("should preserve a complete value after a fault at $phase", async ({ phase, expected }) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ragmir-durable-file-"))
    tempDirs.push(directory)
    const targetPath = path.join(directory, "sidecar.json")
    await writeFile(targetPath, "old", { encoding: "utf8", mode: 0o600 })

    await expect(
      withDurableWriteFaultForTests(failAt(phase), () =>
        writePrivateFileAtomic(targetPath, directory, async (handle) => {
          await handle.writeFile("new", "utf8")
        }),
      ),
    ).rejects.toThrow(`fault:${phase}`)

    await expect(readFile(targetPath, "utf8")).resolves.toBe(expected)
    expect((await readdir(directory)).filter((entry) => entry.endsWith(".tmp"))).toEqual([])
  })
})

function failAt(phase: DurableWritePhase) {
  return (event: { phase: DurableWritePhase }): void => {
    if (event.phase === phase) {
      throw new Error(`fault:${phase}`)
    }
  }
}

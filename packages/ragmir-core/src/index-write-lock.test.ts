import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { loadConfig } from "./config.js"
import type { RagmirError } from "./errors.js"
import { readIndexWriteLockOwner, withIndexWriteLock } from "./index-write-lock.js"
import { audit } from "./ingest.js"
import { readIngestionState } from "./ingestion-state.js"
import { initProject } from "./init.js"
import { readIndexManifest, readRows } from "./store.js"

const tempDirs: string[] = []
const childProcesses = new Set<ChildProcessWithoutNullStreams>()
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const lockChildPath = path.join(packageRoot, "scripts", "index-write-lock-child.mjs")
const cliPath = path.join(packageRoot, "dist", "cli.js")

afterEach(async () => {
  for (const child of childProcesses) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL")
    }
  }
  childProcesses.clear()
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("withIndexWriteLock", () => {
  it("should let a queued caller abort without interrupting the active writer", async () => {
    const storageDir = await temporaryStorage("ragmir-lock-abort-")
    let markWriterStarted: (() => void) | undefined
    const writerStarted = new Promise<void>((resolve) => {
      markWriterStarted = resolve
    })
    let releaseWriter: (() => void) | undefined
    const writerFinished = new Promise<void>((resolve) => {
      releaseWriter = resolve
    })
    const active = withIndexWriteLock(storageDir, undefined, async () => {
      markWriterStarted?.()
      await writerFinished
      return "written"
    })
    await writerStarted

    const controller = new AbortController()
    const queued = withIndexWriteLock(storageDir, controller.signal, async () => "unexpected")

    controller.abort()
    await expect(queued).rejects.toMatchObject({
      code: "ABORTED",
    } satisfies Partial<RagmirError>)

    let nextWriterStarted = false
    const next = withIndexWriteLock(storageDir, undefined, async () => {
      nextWriterStarted = true
      return "next"
    })
    await Promise.resolve()
    expect(nextWriterStarted).toBe(false)

    releaseWriter?.()
    await expect(active).resolves.toBe("written")
    await expect(next).resolves.toBe("next")
  })

  it("should expose a timeout while waiting for the active writer", async () => {
    const storageDir = await temporaryStorage("ragmir-lock-timeout-")
    let releaseWriter: (() => void) | undefined
    const writerFinished = new Promise<void>((resolve) => {
      releaseWriter = resolve
    })
    const active = withIndexWriteLock(storageDir, undefined, async () => {
      await writerFinished
      return "written"
    })
    const queued = withIndexWriteLock(storageDir, AbortSignal.timeout(5), async () => "unexpected")

    await expect(queued).rejects.toMatchObject({
      code: "TIMEOUT",
      retryable: true,
    } satisfies Partial<RagmirError>)
    releaseWriter?.()
    await expect(active).resolves.toBe("written")
  })

  it("should serialize independent writer processes", async () => {
    const root = await temporaryRoot("ragmir-lock-processes-")
    const storageDir = path.join(root, "storage")
    const logPath = path.join(root, "events.jsonl")
    const first = spawnLockChild(storageDir, "first", 150, 2_000, logPath)
    await waitForEvent(first, "acquired")
    const second = spawnLockChild(storageDir, "second", 20, 2_000, logPath)

    await expect(waitForExit(first)).resolves.toMatchObject({ code: 0 })
    await expect(waitForExit(second)).resolves.toMatchObject({ code: 0 })

    const events = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map(parseChildEvent)
      .map((event) => `${event.label}:${event.event}`)
    expect(events).toEqual(["first:acquired", "first:leaving", "second:acquired", "second:leaving"])
    await expect(readIndexWriteLockOwner(storageDir)).resolves.toBeNull()
  })

  it("should return INDEX_BUSY without stealing a live owner and keep heartbeats current", async () => {
    const root = await temporaryRoot("ragmir-lock-busy-")
    const storageDir = path.join(root, "storage")
    const active = spawnLockChild(storageDir, "active", 300, 2_000)
    const acquired = await waitForEvent(active, "acquired")
    const firstHeartbeat = (await readIndexWriteLockOwner(storageDir))?.heartbeatAt
    await delay(60)
    const secondHeartbeat = (await readIndexWriteLockOwner(storageDir))?.heartbeatAt
    const blocked = spawnLockChild(storageDir, "blocked", 10, 50)

    await expect(waitForExit(blocked)).resolves.toMatchObject({ code: 1 })
    expect(parseLastError(blocked.stderr).code).toBe("INDEX_BUSY")
    expect((await readIndexWriteLockOwner(storageDir))?.ownerToken).toBe(acquired.owner?.ownerToken)
    expect(secondHeartbeat).not.toBe(firstHeartbeat)
    await expect(waitForExit(active)).resolves.toMatchObject({ code: 0 })
  })

  it("should recover a lock after its owner is killed", async () => {
    const root = await temporaryRoot("ragmir-lock-kill-")
    const storageDir = path.join(root, "storage")
    const killed = spawnLockChild(storageDir, "killed", 5_000, 2_000)
    const killedOwner = (await waitForEvent(killed, "acquired")).owner
    killed.process.kill("SIGKILL")
    await waitForExit(killed)

    const recovered = spawnLockChild(storageDir, "recovered", 10, 2_000)
    const recoveredOwner = (await waitForEvent(recovered, "acquired")).owner

    expect(recoveredOwner?.ownerToken).not.toBe(killedOwner?.ownerToken)
    await expect(waitForExit(recovered)).resolves.toMatchObject({ code: 0 })
    await expect(readIndexWriteLockOwner(storageDir)).resolves.toBeNull()
  })

  it.each([
    "SIGINT",
    "SIGTERM",
  ] as const)("should release the writer lock during %s shutdown", async (signal) => {
    if (process.platform === "win32") {
      return
    }
    const root = await temporaryRoot(`ragmir-lock-${signal.toLowerCase()}-`)
    const storageDir = path.join(root, "storage")
    const interrupted = spawnLockChild(storageDir, "interrupted", 5_000, 2_000)
    await waitForEvent(interrupted, "acquired")
    interrupted.process.kill(signal)
    await waitForExit(interrupted)

    const next = spawnLockChild(storageDir, "next", 10, 2_000)
    await expect(waitForEvent(next, "acquired")).resolves.toMatchObject({ label: "next" })
    await expect(waitForExit(next)).resolves.toMatchObject({ code: 0 })
  })

  it("should keep rows, manifests, state, and audit consistent after two concurrent CLI ingests", async () => {
    const root = await temporaryRoot("ragmir-lock-ingest-")
    await initProject(root)
    const rawDir = path.join(root, ".ragmir", "raw")
    await mkdir(rawDir, { recursive: true })
    await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        writeFile(
          path.join(rawDir, `evidence-${index}.md`),
          `Evidence ${index} has a unique writer-lock fact.\n`,
          "utf8",
        ),
      ),
    )

    const first = spawnCommand([
      cliPath,
      "--project-root",
      root,
      "ingest",
      "--batch-size",
      "1",
      "--json",
    ])
    const second = spawnCommand([
      cliPath,
      "--project-root",
      root,
      "ingest",
      "--batch-size",
      "1",
      "--json",
    ])

    await expect(waitForExit(first, 15_000)).resolves.toMatchObject({ code: 0 })
    await expect(waitForExit(second, 15_000)).resolves.toMatchObject({ code: 0 })

    const config = await loadConfig(root)
    const rows = await readRows(config)
    const manifest = await readIndexManifest(config)
    const state = await readIngestionState(config)
    const report = await audit(root)
    expect(rows).toHaveLength(40)
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length)
    expect(manifest?.chunkCount).toBe(rows.length)
    expect(manifest?.indexedFiles).toHaveLength(40)
    expect(state).toMatchObject({ status: "completed" })
    expect(state?.files.filter((file) => file.state === "indexed")).toHaveLength(40)
    expect(report).toMatchObject({
      missingFromIndex: [],
      staleInIndex: [],
      totalChunks: rows.length,
    })
  })
})

interface ChildEvent {
  event: string
  label: string
  owner?: { ownerToken?: string }
}

interface RunningChild {
  process: ChildProcessWithoutNullStreams
  events: ChildEvent[]
  stdout: string
  stderr: string
}

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirs.push(root)
  return root
}

async function temporaryStorage(prefix: string): Promise<string> {
  return path.join(await temporaryRoot(prefix), "storage")
}

function spawnLockChild(
  storageDir: string,
  label: string,
  holdMs: number,
  waitTimeoutMs: number,
  logPath?: string,
): RunningChild {
  return spawnCommand(
    [
      lockChildPath,
      storageDir,
      label,
      String(holdMs),
      String(waitTimeoutMs),
      ...(logPath ? [logPath] : []),
    ],
    true,
  )
}

function spawnCommand(arguments_: string[], captureEvents = false): RunningChild {
  const child = spawn(process.execPath, arguments_, { stdio: "pipe" })
  childProcesses.add(child)
  const running: RunningChild = { process: child, events: [], stdout: "", stderr: "" }
  let stdoutBuffer = ""
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  child.stdout.on("data", (chunk: string) => {
    running.stdout += chunk
    stdoutBuffer += chunk
    if (captureEvents) {
      const lines = stdoutBuffer.split("\n")
      stdoutBuffer = lines.pop() ?? ""
      for (const line of lines.filter((entry) => entry.length > 0)) {
        running.events.push(parseChildEvent(line))
      }
    }
  })
  child.stderr.on("data", (chunk: string) => {
    running.stderr += chunk
  })
  child.once("close", () => childProcesses.delete(child))
  return running
}

async function waitForEvent(
  child: RunningChild,
  event: string,
  timeoutMs = 3_000,
): Promise<ChildEvent> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = child.events.find((entry) => entry.event === event)
    if (found) {
      return found
    }
    if (child.process.exitCode !== null || child.process.signalCode !== null) {
      throw new Error(`Child exited before ${event}. stdout=${child.stdout} stderr=${child.stderr}`)
    }
    await delay(10)
  }
  throw new Error(`Timed out waiting for child event ${event}.`)
}

async function waitForExit(
  child: RunningChild,
  timeoutMs = 5_000,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.process.exitCode !== null || child.process.signalCode !== null) {
    return { code: child.process.exitCode, signal: child.process.signalCode }
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for child exit. stderr=${child.stderr}`))
    }, timeoutMs)
    child.process.once("close", (code, signal) => {
      clearTimeout(timeout)
      resolve({ code, signal })
    })
  })
}

function parseChildEvent(line: string): ChildEvent {
  const value: unknown = JSON.parse(line)
  if (
    typeof value !== "object" ||
    value === null ||
    !("event" in value) ||
    typeof value.event !== "string" ||
    !("label" in value) ||
    typeof value.label !== "string"
  ) {
    throw new Error(`Invalid child event: ${line}`)
  }
  const owner =
    "owner" in value &&
    typeof value.owner === "object" &&
    value.owner !== null &&
    "ownerToken" in value.owner &&
    typeof value.owner.ownerToken === "string"
      ? { ownerToken: value.owner.ownerToken }
      : undefined
  return { event: value.event, label: value.label, ...(owner ? { owner } : {}) }
}

function parseLastError(stderr: string): { code: string | null } {
  const line = stderr
    .trim()
    .split("\n")
    .findLast((entry) => entry.length > 0)
  const value: unknown = line ? JSON.parse(line) : null
  if (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    (typeof value.code === "string" || value.code === null)
  ) {
    return { code: value.code }
  }
  throw new Error(`Invalid child error: ${stderr}`)
}

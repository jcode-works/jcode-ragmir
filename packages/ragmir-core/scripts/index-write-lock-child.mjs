import { appendFile } from "node:fs/promises"
import { setTimeout as delay } from "node:timers/promises"
import { withIndexWriteLock } from "../dist/index-write-lock.js"

const [storageDir, label = "child", holdValue = "100", waitValue = "1000", logPath] =
  process.argv.slice(2)

if (!storageDir) {
  throw new Error("storageDir is required.")
}

const holdMs = positiveInteger(holdValue, "holdMs")
const waitTimeoutMs = positiveInteger(waitValue, "waitTimeoutMs")

try {
  await withIndexWriteLock(
    storageDir,
    undefined,
    async (owner) => {
      await emit({ event: "acquired", label, owner, time: Date.now() })
      await delay(holdMs)
      await emit({ event: "leaving", label, owner, time: Date.now() })
    },
    { waitTimeoutMs, pollIntervalMs: 10, heartbeatIntervalMs: 20 },
  )
  process.stdout.write(`${JSON.stringify({ event: "released", label, time: Date.now() })}\n`)
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      event: "error",
      label,
      code: typeof error === "object" && error !== null && "code" in error ? error.code : null,
      message: error instanceof Error ? error.message : String(error),
    })}\n`,
  )
  process.exitCode = 1
}

async function emit(event) {
  const line = `${JSON.stringify(event)}\n`
  process.stdout.write(line)
  if (logPath) {
    await appendFile(logPath, line, "utf8")
  }
}

function positiveInteger(value, name) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return parsed
}

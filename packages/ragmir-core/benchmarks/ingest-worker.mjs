import { createRagmirClient } from "../dist/index.js"

const root = process.argv[2]
if (!root) {
  throw new Error("Expected benchmark project root.")
}

const client = await createRagmirClient({ cwd: root })
try {
  process.send?.({ type: "started" })
  const result = await client.ingest({ rebuild: true })
  process.send?.({ type: "completed", result })
} finally {
  await client.close()
}

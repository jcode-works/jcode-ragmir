import { rm } from "node:fs/promises"

// Clear emitted files for removed modules before rebuilding the public package.
await rm(new URL("../dist/", import.meta.url), { recursive: true, force: true })

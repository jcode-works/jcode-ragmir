import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { isRecord } from "./guards.js"

export interface ProjectConfigLocation {
  configPath: string
  projectRoot: string
}

export interface ProjectConfigMutation<T> {
  changed: boolean
  value: T
}

const writeQueues = new Map<string, Promise<void>>()

export async function readProjectConfigObject(
  location: ProjectConfigLocation,
): Promise<Record<string, unknown>> {
  if (!existsSync(location.configPath)) return {}
  const value: unknown = JSON.parse(await readFile(location.configPath, "utf8"))
  if (!isRecord(value)) {
    const displayPath =
      path.relative(location.projectRoot, location.configPath) || location.configPath
    throw new Error(`${displayPath} must contain a JSON object.`)
  }
  return value
}

export async function mutateProjectConfig<T>(
  location: ProjectConfigLocation,
  mutate: (
    current: Record<string, unknown>,
  ) => ProjectConfigMutation<T> | Promise<ProjectConfigMutation<T>>,
): Promise<T> {
  const previous = writeQueues.get(location.configPath) ?? Promise.resolve()
  const operation = previous
    .catch(() => undefined)
    .then(async () => {
      const current = await readProjectConfigObject(location)
      const mutation = await mutate(current)
      if (mutation.changed) {
        await writeProjectConfigObject(location.configPath, current)
      }
      return mutation.value
    })
  const tail = operation.then(
    () => undefined,
    () => undefined,
  )
  writeQueues.set(location.configPath, tail)

  try {
    return await operation
  } finally {
    if (writeQueues.get(location.configPath) === tail) {
      writeQueues.delete(location.configPath)
    }
  }
}

async function writeProjectConfigObject(
  configPath: string,
  value: Record<string, unknown>,
): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true })
  const temporaryPath = path.join(
    path.dirname(configPath),
    `.${path.basename(configPath)}.${process.pid}.${randomUUID()}.tmp`,
  )
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    })
    await rename(temporaryPath, configPath)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

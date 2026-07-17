import { chmod, mkdir } from "node:fs/promises"

export async function ensurePrivateDirectory(directory: string): Promise<void> {
  const created = await mkdir(directory, { recursive: true, mode: 0o700 })
  if (created !== undefined && process.platform !== "win32") {
    await chmod(directory, 0o700)
  }
}

export async function hardenPrivateFile(filePath: string): Promise<void> {
  if (process.platform !== "win32") {
    await chmod(filePath, 0o600)
  }
}

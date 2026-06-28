import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"

export type PackageManager = "pnpm" | "npm" | "yarn" | "bun"

export interface KbCommand {
  packageManager: PackageManager
  command: string
  args: string[]
  display: string
}

export async function detectPackageManager(cwd = process.cwd()): Promise<PackageManager> {
  const root = path.resolve(cwd)
  const packageManager = await packageJsonManager(root)
  if (packageManager) {
    return packageManager
  }
  if (existsSync(path.join(root, "pnpm-lock.yaml"))) {
    return "pnpm"
  }
  if (
    existsSync(path.join(root, "package-lock.json")) ||
    existsSync(path.join(root, "npm-shrinkwrap.json"))
  ) {
    return "npm"
  }
  if (existsSync(path.join(root, "yarn.lock"))) {
    return "yarn"
  }
  if (existsSync(path.join(root, "bun.lock")) || existsSync(path.join(root, "bun.lockb"))) {
    return "bun"
  }
  return "pnpm"
}

export async function kbCommand(cwd: string, args: string[]): Promise<KbCommand> {
  const packageManager = await detectPackageManager(cwd)
  const commandArgs = commandArgsFor(packageManager, args)
  return {
    packageManager,
    command: commandArgs.command,
    args: commandArgs.args,
    display: displayCommand(packageManager, args),
  }
}

async function packageJsonManager(root: string): Promise<PackageManager | null> {
  const packageJsonPath = path.join(root, "package.json")
  if (!existsSync(packageJsonPath)) {
    return null
  }

  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      packageManager?: unknown
    }
    if (typeof packageJson.packageManager !== "string") {
      return null
    }
    if (packageJson.packageManager.startsWith("pnpm@")) {
      return "pnpm"
    }
    if (packageJson.packageManager.startsWith("npm@")) {
      return "npm"
    }
    if (packageJson.packageManager.startsWith("yarn@")) {
      return "yarn"
    }
    if (packageJson.packageManager.startsWith("bun@")) {
      return "bun"
    }
  } catch {
    return null
  }

  return null
}

function commandArgsFor(
  packageManager: PackageManager,
  args: string[],
): { command: string; args: string[] } {
  switch (packageManager) {
    case "npm":
      return { command: "npx", args: ["kb", ...args] }
    case "yarn":
      return { command: "yarn", args: ["exec", "kb", ...args] }
    case "bun":
      return { command: "bunx", args: ["kb", ...args] }
    case "pnpm":
      return { command: "pnpm", args: ["exec", "kb", ...args] }
  }
}

function displayCommand(packageManager: PackageManager, args: string[]): string {
  const suffix = args.map(formatArg).join(" ")
  switch (packageManager) {
    case "npm":
      return `npx kb${suffix ? ` ${suffix}` : ""}`
    case "yarn":
      return `yarn exec kb${suffix ? ` ${suffix}` : ""}`
    case "bun":
      return `bunx kb${suffix ? ` ${suffix}` : ""}`
    case "pnpm":
      return `pnpm exec kb${suffix ? ` ${suffix}` : ""}`
  }
}

function formatArg(arg: string): string {
  return /\s/.test(arg) ? JSON.stringify(arg) : arg
}

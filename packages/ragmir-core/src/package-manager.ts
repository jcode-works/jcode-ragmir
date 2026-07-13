import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"

export type PackageManager = "pnpm" | "npm" | "yarn" | "bun"
const RGR_CLI_BIN = "rgr"
export const RGR_RUNNER_FILENAME = "run.cjs"
export const RGR_RUNNER_PROBE_ARG = "--ragmir-runner-probe"

export interface RagmirCommand {
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

export async function rgrCommand(cwd: string, args: string[]): Promise<RagmirCommand> {
  const root = path.resolve(cwd)
  const packageManager = await detectPackageManager(root)
  const runnerPath = path.join(root, ".ragmir", RGR_RUNNER_FILENAME)
  if (existsSync(runnerPath)) {
    return {
      packageManager,
      command: "node",
      args: [runnerPath, ...args],
      display: displayRunnerCommand(root, runnerPath, args),
    }
  }
  const commandArgs = commandArgsFor(packageManager, args)
  return {
    packageManager,
    command: commandArgs.command,
    args: commandArgs.args,
    display: displayCommand(packageManager, args),
  }
}

function displayRunnerCommand(root: string, runnerPath: string, args: string[]): string {
  const relativeRunner = path.relative(root, runnerPath) || runnerPath
  const suffix = [relativeRunner, ...args].map(formatArg).join(" ")
  return `node ${suffix}`
}

export const ragmirCommand = rgrCommand
export const kbCommand = rgrCommand

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
      return { command: "npx", args: [RGR_CLI_BIN, ...args] }
    case "yarn":
      return { command: "yarn", args: ["exec", RGR_CLI_BIN, ...args] }
    case "bun":
      return { command: "bunx", args: [RGR_CLI_BIN, ...args] }
    case "pnpm":
      return { command: "pnpm", args: ["exec", RGR_CLI_BIN, ...args] }
  }
}

function displayCommand(packageManager: PackageManager, args: string[]): string {
  const suffix = args.map(formatArg).join(" ")
  switch (packageManager) {
    case "npm":
      return `npx ${RGR_CLI_BIN}${suffix ? ` ${suffix}` : ""}`
    case "yarn":
      return `yarn exec ${RGR_CLI_BIN}${suffix ? ` ${suffix}` : ""}`
    case "bun":
      return `bunx ${RGR_CLI_BIN}${suffix ? ` ${suffix}` : ""}`
    case "pnpm":
      return `pnpm exec ${RGR_CLI_BIN}${suffix ? ` ${suffix}` : ""}`
  }
}

function formatArg(arg: string): string {
  return /\s/.test(arg) ? JSON.stringify(arg) : arg
}

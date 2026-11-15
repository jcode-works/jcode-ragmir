import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { isRecord } from "./guards.js"
import { VERSION } from "./version.js"

export type PackageManager = "pnpm" | "npm" | "yarn" | "bun"
const RGR_CLI_BIN = "rgr"
const RAGMIR_PACKAGE = "@jcode.labs/ragmir"
// dist/package-manager.js, or src/ in tests, sits one folder below the package root.
const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url))
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
  if (!(await projectHasRagmir(root))) {
    if (isGlobalInstall()) {
      // The official Docker image and `npm install --global` put this CLI on PATH as `rgr`.
      return {
        packageManager,
        command: RGR_CLI_BIN,
        args,
        display: [RGR_CLI_BIN, ...args].map(formatArg).join(" "),
      }
    }
    // Without a project install, `pnpm exec rgr` fails and `npx rgr` asks npm for a package named
    // `rgr`, so name the release this CLI belongs to, as the generated runner does.
    const pinnedArgs = ["--yes", `${RAGMIR_PACKAGE}@${VERSION}`, ...args]
    return {
      packageManager,
      command: "npx",
      args: pinnedArgs,
      display: `npx ${pinnedArgs.map(formatArg).join(" ")}`,
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
  // Forward slashes work for node on every platform and match the documented commands.
  const relativeRunner = (path.relative(root, runnerPath) || runnerPath).split(path.sep).join("/")
  const suffix = [relativeRunner, ...args].map(formatArg).join(" ")
  return `node ${suffix}`
}

/**
 * Whether the package sits in npm's default global folder for this Node.js, as in the official
 * Docker image or after `npm install --global`. An npx cache or a custom npm prefix does not count.
 */
export function isGlobalInstall(packageRoot = PACKAGE_ROOT, execPath = process.execPath): boolean {
  const globalRoot = path.join(path.dirname(path.dirname(execPath)), "lib", "node_modules")
  const relative = path.relative(globalRoot, packageRoot)
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
}

/**
 * Whether the project's package manager can run the CLI: Ragmir sits in a node_modules folder at or
 * above the project, its package.json declares it (Yarn Plug'n'Play keeps no node_modules), or the
 * project is the Ragmir repository itself.
 */
async function projectHasRagmir(root: string): Promise<boolean> {
  if (
    (await isRagmirPackage(path.join(root, "packages", "ragmir-core"))) ||
    (await declaresRagmir(path.join(root, "package.json")))
  ) {
    return true
  }
  let current = root
  while (true) {
    if (await isRagmirPackage(path.join(current, "node_modules", ...RAGMIR_PACKAGE.split("/")))) {
      return true
    }
    const parent = path.dirname(current)
    if (parent === current) {
      return false
    }
    current = parent
  }
}

async function isRagmirPackage(packageDir: string): Promise<boolean> {
  const manifest = await readJsonObject(path.join(packageDir, "package.json"))
  return manifest?.name === RAGMIR_PACKAGE
}

async function declaresRagmir(packageJsonPath: string): Promise<boolean> {
  const manifest = await readJsonObject(packageJsonPath)
  return ["dependencies", "devDependencies", "optionalDependencies"].some((field) => {
    const dependencies = manifest?.[field]
    return isRecord(dependencies) && RAGMIR_PACKAGE in dependencies
  })
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown> | null> {
  if (!existsSync(filePath)) {
    return null
  }
  try {
    const value: unknown = JSON.parse(await readFile(filePath, "utf8"))
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

/** @deprecated Use `rgrCommand`. @alias */
export const ragmirCommand = rgrCommand
/** @deprecated Use `rgrCommand`. @alias */
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

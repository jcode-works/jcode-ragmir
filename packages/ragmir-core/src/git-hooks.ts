import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { chmod, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { RAGMIR_DIR } from "./defaults.js"
import { RGR_RUNNER_FILENAME } from "./package-manager.js"
import { canonicalSourcePath } from "./source-paths.js"

export const GIT_HOOK_NAMES = [
  "post-checkout",
  "post-commit",
  "post-merge",
  "post-rewrite",
] as const
export type GitHookName = (typeof GIT_HOOK_NAMES)[number]

const BLOCK_START = "# >>> ragmir auto-ingest >>>"
const BLOCK_END = "# <<< ragmir auto-ingest <<<"
const SHEBANG = "#!/bin/sh"

export interface GitHooksOptions {
  cwd?: string
  /** Write into a hooks directory tracked inside the working tree, such as `.husky/`. */
  force?: boolean
}

export interface GitHooksReport {
  hooksDir: string
  workTree: string
  /** `husky` when husky owns the hooks: Ragmir then edits its tracked `.husky/<hook>` scripts. */
  manager: GitHooksManager
  /** The hooks directory lives inside the working tree, so its files are usually committed. */
  trackedHooksDir: boolean
  installed: GitHookName[]
  missing: GitHookName[]
  changed: GitHookName[]
}

/**
 * Refresh the index in the background after Git changes files: commits, merges, checkouts, and
 * rebases. Each hook gets one marked block, existing hook content is preserved, and the block runs
 * the project's generated runner so it uses the same Ragmir version as the agents.
 */
export async function installGitHooks(options: GitHooksOptions = {}): Promise<GitHooksReport> {
  const location = await gitHooksLocation(options.cwd)
  if (location.trackedHooksDir && location.manager !== "husky" && options.force !== true) {
    throw new Error(
      `Git hooks resolve to ${location.hooksDir}, inside the working tree (for example a husky directory). Add the Ragmir block to that tool's hook files, or rerun with --force to edit them.`,
    )
  }
  await mkdir(location.hooksDir, { recursive: true })
  const changed: GitHookName[] = []
  for (const hookName of GIT_HOOK_NAMES) {
    const hookPath = path.join(location.hooksDir, hookName)
    const current = existsSync(hookPath) ? await readFile(hookPath, "utf8") : null
    const next = withRagmirBlock(current, ragmirHookBlock(location.projectPath))
    if (next !== current) {
      await writeFile(hookPath, next, "utf8")
      changed.push(hookName)
    }
    if (process.platform !== "win32") {
      await chmod(hookPath, 0o755)
    }
  }
  return reportFor(location, changed)
}

export async function uninstallGitHooks(options: GitHooksOptions = {}): Promise<GitHooksReport> {
  const location = await gitHooksLocation(options.cwd)
  const changed: GitHookName[] = []
  for (const hookName of GIT_HOOK_NAMES) {
    const hookPath = path.join(location.hooksDir, hookName)
    if (!existsSync(hookPath)) {
      continue
    }
    const current = await readFile(hookPath, "utf8")
    const next = withoutRagmirBlock(current)
    if (next === current) {
      continue
    }
    if (next.replace(SHEBANG, "").trim().length === 0) {
      await rm(hookPath, { force: true })
    } else {
      await writeFile(hookPath, next, "utf8")
    }
    changed.push(hookName)
  }
  return reportFor(location, changed)
}

export async function gitHooksStatus(options: GitHooksOptions = {}): Promise<GitHooksReport> {
  return reportFor(await gitHooksLocation(options.cwd), [])
}

export type GitHooksManager = "git" | "husky"

interface GitHooksLocation {
  hooksDir: string
  workTree: string
  manager: GitHooksManager
  trackedHooksDir: boolean
  /** Project root relative to the work tree, with forward slashes for the POSIX hook shell. */
  projectPath: string
}

async function gitHooksLocation(cwd = process.cwd()): Promise<GitHooksLocation> {
  // Git reports real paths (macOS resolves /var to /private/var), so compare real paths too.
  const projectRoot = await realpath(path.resolve(cwd))
  const workTree = path.resolve(
    (await git(projectRoot, ["rev-parse", "--show-toplevel"])).trim() || projectRoot,
  )
  // Resolves core.hooksPath and linked worktrees the way Git itself does.
  const hooksPath = (await git(projectRoot, ["rev-parse", "--git-path", "hooks"])).trim()
  const gitHooksDir = path.resolve(projectRoot, hooksPath)
  const huskyDir = huskyScriptsDir(gitHooksDir)
  const hooksDir = huskyDir ?? gitHooksDir
  const gitDir = path.resolve(
    projectRoot,
    (await git(projectRoot, ["rev-parse", "--git-common-dir"])).trim(),
  )
  const insideWorkTree = isInside(hooksDir, workTree)
  const insideGitDir = isInside(hooksDir, gitDir)
  return {
    hooksDir,
    workTree,
    manager: huskyDir === null ? "git" : "husky",
    trackedHooksDir: insideWorkTree && !insideGitDir,
    projectPath: canonicalSourcePath(path.relative(workTree, projectRoot)) || ".",
  }
}

/**
 * The folder of husky's hook scripts when husky owns the Git hooks. husky 9 points core.hooksPath at
 * `.husky/_`, which it regenerates on every install and whose shims run `.husky/<hook>`; husky 8
 * points it at `.husky` itself. Hooks belong in the `.husky/<hook>` scripts in both cases.
 */
function huskyScriptsDir(gitHooksDir: string): string | null {
  if (path.basename(gitHooksDir) === "_" && path.basename(path.dirname(gitHooksDir)) === ".husky") {
    return existsSync(path.join(gitHooksDir, "h")) ? path.dirname(gitHooksDir) : null
  }
  if (path.basename(gitHooksDir) === ".husky") {
    return existsSync(path.join(gitHooksDir, "_", "husky.sh")) ? gitHooksDir : null
  }
  return null
}

function ragmirHookBlock(projectPath: string): string {
  const runner = `${RAGMIR_DIR}/${RGR_RUNNER_FILENAME}`
  return [
    BLOCK_START,
    "# Refresh the Ragmir index in the background after Git changes files.",
    "# Remove with `rgr hooks uninstall`.",
    `(cd ${shellQuote(projectPath)} 2>/dev/null && [ -f ${runner} ] && command -v node >/dev/null 2>&1 && node ${runner} ingest >/dev/null 2>&1 &) || true`,
    BLOCK_END,
  ].join("\n")
}

function withRagmirBlock(current: string | null, block: string): string {
  if (current === null || current.trim().length === 0) {
    return `${SHEBANG}\n\n${block}\n`
  }
  if (current.includes(BLOCK_START)) {
    return replaceBlock(current, block)
  }
  const lines = current.replace(/\s+$/u, "").split("\n")
  // A hook that ends with `exit` would never reach an appended block.
  const lastLine = lines.at(-1)?.trim() ?? ""
  if (/^exit(\s|$)/u.test(lastLine)) {
    return [...lines.slice(0, -1), "", block, lines.at(-1), ""].join("\n")
  }
  return `${lines.join("\n")}\n\n${block}\n`
}

function withoutRagmirBlock(current: string): string {
  let start = current.indexOf(BLOCK_START)
  if (start === -1) {
    return current
  }
  const endMarker = current.indexOf(BLOCK_END, start)
  let end = endMarker === -1 ? current.length : endMarker + BLOCK_END.length
  // Drop the blank separator line and the newline that installation added around the block.
  if (current.slice(start - 2, start) === "\n\n") {
    start -= 1
  }
  if (current[end] === "\n") {
    end += 1
  }
  return `${current.slice(0, start)}${current.slice(end)}`
}

function replaceBlock(current: string, block: string): string {
  const start = current.indexOf(BLOCK_START)
  const endMarker = current.indexOf(BLOCK_END, start)
  const end = endMarker === -1 ? current.length : endMarker + BLOCK_END.length
  return `${current.slice(0, start)}${block}${current.slice(end)}`
}

async function reportFor(
  location: GitHooksLocation,
  changed: GitHookName[],
): Promise<GitHooksReport> {
  const installed: GitHookName[] = []
  const missing: GitHookName[] = []
  for (const hookName of GIT_HOOK_NAMES) {
    const hookPath = path.join(location.hooksDir, hookName)
    const content = existsSync(hookPath) ? await readFile(hookPath, "utf8") : ""
    if (content.includes(BLOCK_START)) {
      installed.push(hookName)
    } else {
      missing.push(hookName)
    }
  }
  return {
    hooksDir: location.hooksDir,
    workTree: location.workTree,
    manager: location.manager,
    trackedHooksDir: location.trackedHooksDir,
    installed,
    missing,
    changed,
  }
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, encoding: "utf8", windowsHide: true }, (error, stdout) => {
      if (error) {
        reject(
          new Error(
            `Git hooks need a Git repository and the git command (${error.message.split("\n")[0]}).`,
          ),
        )
        return
      }
      resolve(stdout)
    })
  })
}

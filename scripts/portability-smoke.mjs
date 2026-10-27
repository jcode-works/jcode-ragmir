// Cross-platform proof for the packaged CLI: Unicode-normalized and case-variant paths, Windows
// path input, live freshness, Git hooks, and the generated runner. Runs on Linux, macOS, and Windows.
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const cliPath = path.join(repoRoot, "packages", "ragmir-core", "dist", "cli-entry.js")
const decomposed = "Études"
const composed = "Études"
const checks = []

const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ragmir-portability-"))
try {
  // Folder names stored decomposed, as archives and older macOS volumes produce them.
  await mkdir(path.join(projectRoot, "docs", decomposed), { recursive: true })
  await mkdir(path.join(projectRoot, "docs", "Guides"), { recursive: true })
  await mkdir(path.join(projectRoot, ".claude", "skills"), { recursive: true })
  await mkdir(path.join(projectRoot, ".ragmir"), { recursive: true })
  await writeFile(
    path.join(projectRoot, "docs", decomposed, "plan.md"),
    "# Plan\n\nThe migration plan keeps PORTABILITY-ANCHOR evidence local.\n",
  )
  await writeFile(
    path.join(projectRoot, "docs", decomposed, "tarifs.md"),
    "# Tarifs\n\nConfidential pricing PORTABILITY-ANCHOR must stay excluded.\n",
  )
  await writeFile(
    path.join(projectRoot, "docs", "Guides", "Setup.md"),
    "# Setup\n\nInstall steps for PORTABILITY-ANCHOR.\n",
  )
  await writeFile(
    path.join(projectRoot, ".claude", "skills", "tool.md"),
    "Agent skill text PORTABILITY-ANCHOR.\n",
  )
  await writeFile(
    path.join(projectRoot, ".ragmir", "config.json"),
    `${JSON.stringify({ name: "Portability", sources: ["docs", `!docs/${composed}/tarifs.md`] }, null, 2)}\n`,
  )

  const ingest = await rgrJson(["ingest", "--json"])
  check(
    "ingest indexes the two allowed documents",
    ingest.indexedFiles === 2 && ingest.errors.length === 0,
    ingest,
  )

  const search = await rgrJson(["search", "PORTABILITY-ANCHOR", "--top-k", "5", "--json"])
  const paths = search.results.map((result) => result.relativePath)
  check(
    "citations use forward slashes and composed Unicode",
    paths.includes(`docs/${composed}/plan.md`) && paths.every((item) => !item.includes("\\")),
    paths,
  )
  check(
    "the composed exclusion removes the decomposed file",
    !paths.some((item) => item.includes("tarifs")),
    paths,
  )
  check(
    "tool state is excluded by default",
    !paths.some((item) => item.startsWith(".claude/")),
    paths,
  )

  const filtered = await rgrJson([
    "search",
    "PORTABILITY-ANCHOR",
    "--include-path",
    `docs\\${composed}`,
    "--json",
  ])
  check(
    "a Windows-style path filter matches",
    filtered.results.length > 0 &&
      filtered.results.every((result) => result.relativePath.startsWith(`docs/${composed}/`)),
    filtered.results.map((result) => result.relativePath),
  )

  const audit = await rgrJson(["audit", "--json"])
  check(
    "audit reports no unmatched exclusion",
    audit.sourceRules?.unmatchedExclusions?.length === 0 && audit.missingFromIndex.length === 0,
    audit.sourceRules,
  )

  await writeFile(
    path.join(projectRoot, "docs", "Guides", "Setup.md"),
    "# Setup\n\nUpdated install steps for PORTABILITY-ANCHOR.\n",
  )
  const doctor = await rgrJson(["doctor", "--json"])
  check(
    "doctor sees the edit without re-ingesting",
    doctor.cost === "O(files)" &&
      doctor.staleInIndex === 1 &&
      doctor.readiness.coverageComplete === false,
    { cost: doctor.cost, stale: doctor.staleInIndex },
  )
  const changed = await rgrJson(["search", "Updated install steps", "--json"])
  check(
    "search flags the edited source",
    changed.results.some((result) => result.sourceStatus === "modified"),
    changed.results.map((result) => [result.relativePath, result.sourceStatus]),
  )

  await execFileAsync("git", ["init", "--quiet"], { cwd: projectRoot })
  const hooks = await rgrJson(["hooks", "install", "--json"])
  check("Git hooks install in the repository", hooks.installed.length === 4, hooks.installed)
  const postCommit = await readFile(path.join(hooks.hooksDir, "post-commit"), "utf8")
  check(
    "hooks call the project runner",
    postCommit.includes("node .ragmir/run.cjs ingest"),
    postCommit,
  )
  const removed = await rgrJson(["hooks", "uninstall", "--json"])
  check("Git hooks uninstall cleanly", removed.installed.length === 0, removed)

  await rgr(["install-skill"])
  const runnerPath = path.join(projectRoot, ".ragmir", "run.cjs")
  const probe = JSON.parse(
    (
      await execFileAsync(process.execPath, [runnerPath, "--ragmir-runner-probe"], {
        cwd: projectRoot,
        env: { ...process.env, RAGMIR_PROJECT_ROOT: projectRoot },
      })
    ).stdout,
  )
  check(
    "the generated runner verifies a local CLI without npx",
    probe.verified === true && !probe.requiresDownload,
    probe,
  )
  const runnerVersion = await execFileAsync(process.execPath, [runnerPath, "--version"], {
    cwd: projectRoot,
  })
  check(
    "the generated runner runs the CLI",
    runnerVersion.stdout.trim().length > 0,
    runnerVersion.stdout,
  )
} finally {
  await rm(projectRoot, { recursive: true, force: true })
}

const failed = checks.filter((item) => !item.passed)
process.stdout.write(
  `${JSON.stringify({ platform: process.platform, architecture: process.arch, checks, passed: failed.length === 0 }, null, 2)}\n`,
)
if (failed.length > 0) {
  process.exitCode = 1
}

function check(name, passed, detail) {
  checks.push(passed ? { name, passed } : { name, passed, detail })
}

async function rgr(args) {
  return execFileAsync(process.execPath, [cliPath, "--project-root", projectRoot, ...args], {
    cwd: projectRoot,
    maxBuffer: 16 * 1_024 * 1_024,
  })
}

async function rgrJson(args) {
  try {
    return JSON.parse((await rgr(args)).stdout)
  } catch (error) {
    if (typeof error?.stdout === "string" && error.stdout.trim().startsWith("{")) {
      return JSON.parse(error.stdout)
    }
    throw error
  }
}

if (!existsSync(cliPath)) {
  throw new Error("Build the packages first: pnpm build")
}

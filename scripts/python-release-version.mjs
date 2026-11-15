// Write the npm release version into the Python packages before they are built: each package takes
// that version, the integrations pin the same `ragmir`, and `ragmir` launches that npm release.
//
//   node scripts/python-release-version.mjs 6.11.0   rewrite the files for a release build
//   node scripts/python-release-version.mjs --check  verify the committed development markers
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const packagesDir = path.join(repoRoot, "python", "packages")
const DEVELOPMENT_VERSION = "0.0.0"
const projects = ["ragmir", "langchain-ragmir", "llama-index-retrievers-ragmir"]
const integrations = new Set(["langchain-ragmir", "llama-index-retrievers-ragmir"])
const versionModule = path.join(packagesDir, "ragmir", "src", "ragmir", "_version.py")

const argument = process.argv[2]
if (!argument) {
  throw new Error("Usage: python-release-version.mjs <x.y.z> | --check")
}
const check = argument === "--check"
if (!check && !/^\d+\.\d+\.\d+$/u.test(argument)) {
  throw new Error(`Python packages need a final x.y.z version, got "${argument}".`)
}
const version = check ? DEVELOPMENT_VERSION : argument

for (const project of projects) {
  const file = path.join(packagesDir, project, "pyproject.toml")
  const source = await readFile(file, "utf8")
  let next = replaceOnce(
    source,
    /^version = "[^"]+"$/mu,
    `version = "${version}"`,
    `${project} version`,
    `version = "${DEVELOPMENT_VERSION}"`,
  )
  if (integrations.has(project)) {
    // The first entry of the dependencies list, not the "ragmir" keyword.
    next = replaceOnce(
      next,
      /^dependencies = \["ragmir(?:==[^"]*)?"/mu,
      check ? 'dependencies = ["ragmir"' : `dependencies = ["ragmir==${version}"`,
      `${project} ragmir dependency`,
      'dependencies = ["ragmir"',
    )
  }
  if (!check) {
    await writeFile(file, next)
  }
}

const versionSource = await readFile(versionModule, "utf8")
const nextVersionSource = replaceOnce(
  versionSource,
  /^__version__ = "[^"]+"$/mu,
  `__version__ = "${version}"`,
  "ragmir __version__",
  `__version__ = "${DEVELOPMENT_VERSION}"`,
)
if (!check) {
  await writeFile(versionModule, nextVersionSource)
}

console.log(
  check
    ? "Python packages carry the development version and an unpinned ragmir dependency."
    : `Python packages set to ${version}.`,
)

function replaceOnce(source, pattern, replacement, label, committed) {
  const match = pattern.exec(source)
  if (!match) {
    throw new Error(`Could not find the ${label}.`)
  }
  if (check && match[0] !== committed) {
    throw new Error(`The ${label} must stay "${committed}" in the repository, found "${match[0]}".`)
  }
  return source.replace(pattern, replacement)
}

import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const expectedLicense = "AGPL-3.0-only"
const publishedPackageDirs = ["packages/ragmir-core", "packages/ragmir-chat", "packages/ragmir-tts"]
const manifestDirs = [".", ...publishedPackageDirs, "packages/ragmir-landing"]
const requiredPackageFiles = ["LICENSE", "COMMERCIAL-LICENSE.md", "NOTICE"]
const publicPolicyFiles = [
  "AGENTS.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "README.md",
  "RELEASING.md",
  "packages/ragmir-core/README.md",
  "packages/ragmir-chat/README.md",
  "packages/ragmir-tts/README.md",
  "packages/ragmir-landing/README.md",
]
const failures = []
const canonicalLicense = await readFile(path.join(repoRoot, "LICENSE"), "utf8")
const commercialNotice = await readFile(path.join(repoRoot, "COMMERCIAL-LICENSE.md"), "utf8")
const copyrightNotice = await readFile(path.join(repoRoot, "NOTICE"), "utf8")

if (!canonicalLicense.includes("GNU AFFERO GENERAL PUBLIC LICENSE")) {
  failures.push("LICENSE: missing the GNU Affero General Public License heading")
}
if (!canonicalLicense.includes("END OF TERMS AND CONDITIONS")) {
  failures.push("LICENSE: incomplete GNU Affero General Public License text")
}
if (!commercialNotice.includes("contact@jcode.works")) {
  failures.push("COMMERCIAL-LICENSE.md: missing commercial licensing contact")
}
if (!commercialNotice.includes("not itself a grant")) {
  failures.push("COMMERCIAL-LICENSE.md: missing the no-grant boundary")
}
if (!copyrightNotice.includes(expectedLicense)) {
  failures.push(`NOTICE: missing ${expectedLicense}`)
}

for (const directory of manifestDirs) {
  const relativeManifest = path.join(directory, "package.json")
  const manifest = JSON.parse(await readFile(path.join(repoRoot, relativeManifest), "utf8"))
  if (manifest.license !== expectedLicense) {
    failures.push(`${relativeManifest}: expected license ${expectedLicense}`)
  }
}

for (const directory of publishedPackageDirs) {
  const manifest = JSON.parse(
    await readFile(path.join(repoRoot, directory, "package.json"), "utf8"),
  )
  for (const requiredFile of requiredPackageFiles) {
    if (!manifest.files?.includes(requiredFile)) {
      failures.push(`${directory}/package.json: files is missing ${requiredFile}`)
    }
  }

  const packageLicense = await readFile(path.join(repoRoot, directory, "LICENSE"), "utf8")
  const packageCommercialNotice = await readFile(
    path.join(repoRoot, directory, "COMMERCIAL-LICENSE.md"),
    "utf8",
  )
  const packageCopyrightNotice = await readFile(path.join(repoRoot, directory, "NOTICE"), "utf8")

  if (packageLicense !== canonicalLicense) {
    failures.push(`${directory}/LICENSE: differs from the canonical root license`)
  }
  if (packageCommercialNotice !== commercialNotice) {
    failures.push(`${directory}/COMMERCIAL-LICENSE.md: differs from the canonical root notice`)
  }
  if (packageCopyrightNotice !== copyrightNotice) {
    failures.push(`${directory}/NOTICE: differs from the canonical root notice`)
  }
}

for (const relativePath of publicPolicyFiles) {
  const content = await readFile(path.join(repoRoot, relativePath), "utf8")
  if (!content.includes("AGPL")) {
    failures.push(`${relativePath}: missing the AGPL policy`)
  }
  if (
    /(?:\[!\[MIT\]|MIT-licensed packages|open-source MIT project|under the \[MIT License\])/u.test(
      content,
    )
  ) {
    failures.push(`${relativePath}: still presents the current project as MIT licensed`)
  }
}

if (failures.length > 0) {
  throw new Error(`License policy smoke failed:\n${failures.join("\n")}`)
}

console.log("License policy smoke passed.")

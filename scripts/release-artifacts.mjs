import { spawnSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import YAML from "yaml"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const artifactsDir = path.join(repoRoot, "release-artifacts")
const corePackageDir = "packages/ragmir-core"
const packageDirs = [corePackageDir]
const requiredLicenseFiles = ["LICENSE", "COMMERCIAL-LICENSE.md", "NOTICE"]
// Gemini CLI and Qwen Code install the release asset whose name starts with their platform, and
// unpack the source tree only when none matches: that tree still pins the previous release.
const extensionPlatforms = ["darwin", "linux", "win32"]
const extensionEntries = [
  "gemini-extension.json",
  "qwen-extension.json",
  "plugins/ragmir",
  "skills",
  ...requiredLicenseFiles,
]
const corePackageJson = await readPackageJson(corePackageDir)

await rm(artifactsDir, { recursive: true, force: true })
await mkdir(artifactsDir, { recursive: true })

const packages = []
for (const directory of packageDirs) {
  const manifest = await readPackageJson(directory)
  if (manifest.license !== "AGPL-3.0-only") {
    throw new Error(`${manifest.name} must declare AGPL-3.0-only before release`)
  }
  const pack = run(
    "pnpm",
    ["pack", "--json", "--pack-destination", artifactsDir],
    packagePath(directory),
  )
  const packed = JSON.parse(pack.stdout)
  const packedEntry = Array.isArray(packed) ? packed[0] : packed
  const packedFiles = new Set(
    Array.isArray(packedEntry?.files) ? packedEntry.files.map((file) => file.path) : [],
  )
  for (const requiredFile of requiredLicenseFiles) {
    if (!packedFiles.has(requiredFile)) {
      throw new Error(`${manifest.name} tarball is missing ${requiredFile}`)
    }
  }
  const tarball = tarballFilename(packed)
  if (!tarball) {
    throw new Error(
      `pnpm pack did not return a tarball filename for ${manifest.name}: ${pack.stdout}`,
    )
  }
  packages.push({
    name: manifest.name,
    version: manifest.version,
    directory,
    tarball,
  })
}

const sbomFile = `${packageNameForFile(corePackageJson.name)}-${corePackageJson.version}.sbom.cdx.json`
await writeFile(
  path.join(artifactsDir, sbomFile),
  `${JSON.stringify(await buildCycloneDxSbom(), null, 2)}\n`,
  "utf8",
)

const extensionAssets = await buildAgentExtension(corePackageJson.version)

const checksums = await sha256Files(artifactsDir)
await writeFile(
  path.join(artifactsDir, "SHA256SUMS"),
  `${checksums.map((entry) => `${entry.sha256}  ${entry.file}`).join("\n")}\n`,
  "utf8",
)

await writeFile(
  path.join(artifactsDir, "release-manifest.json"),
  `${JSON.stringify(
    {
      package: corePackageJson.name,
      version: corePackageJson.version,
      packages,
      sbom: sbomFile,
      agentExtension: { version: corePackageJson.version, assets: extensionAssets },
      checksums: "SHA256SUMS",
      provenance: "pnpm publish --provenance is enforced by the protected GitHub Actions workflow.",
    },
    null,
    2,
  )}\n`,
  "utf8",
)

console.log(`Release artifacts written to ${path.relative(repoRoot, artifactsDir)}`)

/**
 * The Gemini CLI and Qwen Code extension with every Ragmir pin stamped to this release, packed
 * once per platform name those agents look for.
 */
async function buildAgentExtension(version) {
  const stage = await mkdtemp(path.join(os.tmpdir(), "ragmir-extension-"))
  try {
    for (const entry of extensionEntries) {
      await cp(path.join(repoRoot, entry), path.join(stage, entry), { recursive: true })
    }
    const launcher = await readFile(
      path.join(stage, "plugins/ragmir/scripts/serve-mcp.mjs"),
      "utf8",
    )
    const pin = /RAGMIR_VERSION = "([^"]+)"/u.exec(launcher)?.[1]
    if (!pin) {
      throw new Error("plugins/ragmir/scripts/serve-mcp.mjs must pin a Ragmir version")
    }
    for (const file of await listFiles(stage)) {
      if (![".json", ".md", ".mjs"].includes(path.extname(file))) {
        continue
      }
      const text = await readFile(file, "utf8")
      let stamped = text
        .replaceAll(`RAGMIR_VERSION = "${pin}"`, `RAGMIR_VERSION = "${version}"`)
        .replaceAll(`@jcode.labs/ragmir@${pin}`, `@jcode.labs/ragmir@${version}`)
      if (/^(gemini|qwen)-extension\.json$/u.test(path.basename(file))) {
        stamped = `${JSON.stringify({ ...JSON.parse(stamped), version }, null, 2)}\n`
      }
      const stale = /@jcode\.labs\/ragmir@(\d+\.\d+\.\d+)/gu.exec(stamped)
      if (stale && stale[1] !== version) {
        throw new Error(`${path.relative(stage, file)} pins Ragmir ${stale[1]}, not ${version}`)
      }
      if (stamped !== text) {
        await writeFile(file, stamped, "utf8")
      }
    }
    const assets = extensionPlatforms.map((platform) => `${platform}.ragmir.tar.gz`)
    for (const asset of assets) {
      run("tar", ["-czf", path.join(artifactsDir, asset), "-C", stage, "."])
    }
    return assets
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}

async function listFiles(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
}

function packagePath(directory) {
  return path.join(repoRoot, directory)
}

async function readPackageJson(directory) {
  return JSON.parse(await readFile(path.join(packagePath(directory), "package.json"), "utf8"))
}

function tarballFilename(packed) {
  const entry = Array.isArray(packed) ? packed[0] : packed
  const filename = entry?.filename ?? entry?.path ?? entry?.name
  return typeof filename === "string" ? path.basename(filename) : null
}

function packageNameForFile(packageName) {
  return packageName.replace("/", "-").replace("@", "")
}

function run(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    // macOS tar would otherwise add AppleDouble `._*` files for extended attributes.
    env: { ...process.env, COPYFILE_DISABLE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (result.status !== 0) {
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    )
  }
  return result
}

async function sha256Files(directory) {
  const files = (await readdir(directory)).filter((file) => file !== "SHA256SUMS").sort()
  const checksums = []
  for (const file of files) {
    const buffer = await readFile(path.join(directory, file))
    checksums.push({
      file,
      sha256: createHash("sha256").update(buffer).digest("hex"),
    })
  }
  return checksums
}

async function buildCycloneDxSbom() {
  const lockfile = YAML.parse(await readFile(path.join(repoRoot, "pnpm-lock.yaml"), "utf8"))
  const components = Object.keys(lockfile.packages ?? {})
    .map(parsePnpmPackageKey)
    .filter((component) => component !== null)
    .sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`))

  return {
    $schema: "http://cyclonedx.org/schema/bom-1.5.schema.json",
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [
        {
          vendor: "JCode Works",
          name: "Ragmir release artifacts",
          version: corePackageJson.version,
        },
      ],
      component: {
        type: "library",
        name: corePackageJson.name,
        version: corePackageJson.version,
        licenses: [{ license: { id: corePackageJson.license } }],
        purl: `pkg:npm/${corePackageJson.name}@${corePackageJson.version}`,
      },
    },
    components,
  }
}

function parsePnpmPackageKey(key) {
  const withoutPeers = key.replace(/\(.+\)$/, "")
  const packageRef = withoutPeers.includes("@npm:")
    ? withoutPeers.slice(withoutPeers.indexOf("@npm:") + 5)
    : withoutPeers
  const versionSeparator = packageRef.startsWith("@")
    ? packageRef.indexOf("@", 1)
    : packageRef.lastIndexOf("@")

  if (versionSeparator <= 0) {
    return null
  }

  const name = packageRef.slice(0, versionSeparator)
  const version = packageRef.slice(versionSeparator + 1)
  if (!name || !version) {
    return null
  }

  return {
    type: "library",
    name,
    version,
    scope: "required",
    purl: `pkg:npm/${name}@${version}`,
  }
}

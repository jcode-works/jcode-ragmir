import { spawnSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import YAML from "yaml"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const artifactsDir = path.join(repoRoot, "release-artifacts")
const corePackageDir = "packages/mimir"
const packageDirs = ["packages/mimir-tts", corePackageDir]
const corePackageJson = await readPackageJson(corePackageDir)

await rm(artifactsDir, { recursive: true, force: true })
await mkdir(artifactsDir, { recursive: true })

const packages = []
for (const directory of packageDirs) {
  const manifest = await readPackageJson(directory)
  const pack = run(
    "pnpm",
    ["pack", "--json", "--pack-destination", artifactsDir],
    packagePath(directory),
  )
  const packed = JSON.parse(pack.stdout)
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
      checksums: "SHA256SUMS",
      provenance: "pnpm publish --provenance is enforced by the protected GitHub Actions workflow.",
    },
    null,
    2,
  )}\n`,
  "utf8",
)

console.log(`Release artifacts written to ${path.relative(repoRoot, artifactsDir)}`)

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
        { vendor: "JCode Labs", name: "Mimir release artifacts", version: corePackageJson.version },
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

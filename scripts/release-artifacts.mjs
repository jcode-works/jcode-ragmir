import { spawnSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import YAML from "yaml"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const artifactsDir = path.join(repoRoot, "release-artifacts")
const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"))

await rm(artifactsDir, { recursive: true, force: true })
await mkdir(artifactsDir, { recursive: true })

const pack = run("npm", ["pack", "--json", "--pack-destination", artifactsDir])
const packed = JSON.parse(pack.stdout)
const tarball = packed[0]?.filename
if (!tarball) {
  throw new Error(`npm pack did not return a tarball filename: ${pack.stdout}`)
}

const sbomFile = `${packageJson.name.replace("/", "-").replace("@", "")}-${packageJson.version}.sbom.cdx.json`
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
      package: packageJson.name,
      version: packageJson.version,
      tarball,
      sbom: sbomFile,
      checksums: "SHA256SUMS",
      provenance: "npm publish --provenance is enforced by the protected GitHub Actions workflow.",
    },
    null,
    2,
  )}\n`,
  "utf8",
)

console.log(`Release artifacts written to ${path.relative(repoRoot, artifactsDir)}`)

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
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
        { vendor: "JCode Labs", name: "Mimir release artifacts", version: packageJson.version },
      ],
      component: {
        type: "library",
        name: packageJson.name,
        version: packageJson.version,
        licenses: [{ license: { id: packageJson.license } }],
        purl: `pkg:npm/${packageJson.name}@${packageJson.version}`,
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

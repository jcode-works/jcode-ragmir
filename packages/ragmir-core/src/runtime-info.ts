import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { isRecord } from "./guards.js"
import type { RuntimeInfo, RuntimePackageVersion } from "./types.js"
import { VERSION } from "./version.js"

const packageRequire = createRequire(import.meta.url)

export function runtimeInfo(): RuntimeInfo {
  const lanceDbEntry = resolvePackageEntry(packageRequire, "@lancedb/lancedb")
  const transformersEntry = resolvePackageEntry(packageRequire, "@huggingface/transformers")
  const lanceDbRequire = lanceDbEntry ? createRequire(lanceDbEntry) : packageRequire
  const transformersRequire = transformersEntry ? createRequire(transformersEntry) : packageRequire
  return {
    ragmir: VERSION,
    node: process.versions.node,
    v8: process.versions.v8,
    napi: process.versions.napi ?? null,
    platform: process.platform,
    architecture: process.arch,
    dependencies: {
      lanceDb: resolvedPackage(packageRequire, "@lancedb/lancedb"),
      lanceDbNative: resolvedLanceDbNative(lanceDbRequire),
      apacheArrow: resolvedPackage(lanceDbRequire, "apache-arrow"),
      transformers: resolvedPackage(packageRequire, "@huggingface/transformers"),
      onnxRuntime: resolvedPackage(transformersRequire, "onnxruntime-node"),
      sharp: resolvedPackage(transformersRequire, "sharp"),
    },
  }
}

function resolvedLanceDbNative(requireFrom: NodeRequire): RuntimePackageVersion | null {
  for (const packageName of lanceDbNativeCandidates()) {
    const resolved = resolvedPackage(requireFrom, packageName)
    if (resolved) {
      return resolved
    }
  }
  return null
}

function lanceDbNativeCandidates(): string[] {
  const base = `@lancedb/lancedb-${process.platform}-${process.arch}`
  if (process.platform === "linux") {
    return [`${base}-gnu`, `${base}-musl`]
  }
  return process.platform === "win32" ? [`${base}-msvc`] : [base]
}

function resolvedPackage(
  requireFrom: NodeRequire,
  packageName: string,
): RuntimePackageVersion | null {
  const entry = resolvePackageEntry(requireFrom, packageName)
  if (!entry) {
    return null
  }
  let directory = path.dirname(entry)
  while (true) {
    const manifestPath = path.join(directory, "package.json")
    if (existsSync(manifestPath)) {
      try {
        const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"))
        if (
          isRecord(manifest) &&
          manifest.name === packageName &&
          typeof manifest.version === "string"
        ) {
          return { name: packageName, version: manifest.version }
        }
      } catch {
        return null
      }
    }
    const parent = path.dirname(directory)
    if (parent === directory) {
      return null
    }
    directory = parent
  }
}

function resolvePackageEntry(requireFrom: NodeRequire, packageName: string): string | null {
  try {
    return requireFrom.resolve(packageName)
  } catch {
    return null
  }
}

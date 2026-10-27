import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import fg from "fast-glob"
import { CONFIG_PATH, LEGACY_CONFIG_PATH, SHARED_CONFIG_FILENAME } from "./defaults.js"
import { canonicalSourcePath } from "./source-paths.js"
import type {
  Config,
  KnowledgeBaseIdentity,
  KnowledgeBaseInfo,
  KnowledgeBaseInventory,
} from "./types.js"

const KNOWLEDGE_BASE_PATTERNS = [
  CONFIG_PATH,
  `**/${CONFIG_PATH}`,
  SHARED_CONFIG_FILENAME,
  `**/${SHARED_CONFIG_FILENAME}`,
  LEGACY_CONFIG_PATH,
  `**/${LEGACY_CONFIG_PATH}`,
]
const KNOWLEDGE_BASE_DISCOVERY_IGNORES = [
  "**/.git/**",
  "**/node_modules/**",
  "**/.pnpm/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/.astro/**",
  "**/.svelte-kit/**",
  "**/.turbo/**",
  "**/coverage/**",
]

interface ConfiguredRoot {
  projectRoot: string
  configPath: string
  legacy: boolean
}

export function knowledgeBaseIdentity(start = process.cwd()): KnowledgeBaseIdentity | null {
  const configuredRoots = configuredAncestors(start)
  const active = configuredRoots[0]
  const workspace = configuredRoots.at(-1)
  if (!active || !workspace) {
    return null
  }
  return {
    id: knowledgeBaseId(workspace.projectRoot, active.projectRoot),
    projectRoot: active.projectRoot,
    workspaceRoot: workspace.projectRoot,
  }
}

export async function discoverKnowledgeBases(
  start = process.cwd(),
): Promise<KnowledgeBaseInventory> {
  const resolvedStart = path.resolve(start)
  const identity = knowledgeBaseIdentity(resolvedStart)
  const workspaceRoot = identity?.workspaceRoot ?? resolvedStart
  const configPaths = await fg(KNOWLEDGE_BASE_PATTERNS, {
    cwd: workspaceRoot,
    absolute: true,
    dot: true,
    onlyFiles: true,
    unique: true,
    followSymbolicLinks: false,
    ignore: KNOWLEDGE_BASE_DISCOVERY_IGNORES,
  })
  const byProjectRoot = new Map<string, ConfiguredRoot>()
  // fast-glob returns forward slashes on Windows; identities use native absolute paths.
  for (const configPath of configPaths.map((entry) => path.resolve(entry)).sort()) {
    const configuredRoot = configuredRootForConfig(configPath)
    const existing = byProjectRoot.get(configuredRoot.projectRoot)
    if (!existing || (existing.legacy && !configuredRoot.legacy)) {
      byProjectRoot.set(configuredRoot.projectRoot, configuredRoot)
    }
  }
  const bases: KnowledgeBaseInfo[] = [...byProjectRoot.values()]
    .map((base) => ({
      id: knowledgeBaseId(workspaceRoot, base.projectRoot),
      projectRoot: base.projectRoot,
      configPath: base.configPath,
      legacy: base.legacy,
      active: base.projectRoot === identity?.projectRoot,
    }))
    .sort((left, right) => left.id.localeCompare(right.id))

  return {
    start: resolvedStart,
    workspaceRoot,
    activeProjectRoot: identity?.projectRoot ?? null,
    activeId: identity?.id ?? null,
    bases,
  }
}

function configuredAncestors(start: string): ConfiguredRoot[] {
  const roots: ConfiguredRoot[] = []
  let current = path.resolve(start)
  while (true) {
    const configuredRoot = configuredRootAt(current)
    if (configuredRoot) {
      roots.push(configuredRoot)
    }
    const parent = path.dirname(current)
    if (parent === current) {
      return roots
    }
    current = parent
  }
}

function configuredRootAt(projectRoot: string): ConfiguredRoot | null {
  const configPath = path.join(projectRoot, CONFIG_PATH)
  if (existsSync(configPath)) {
    return { projectRoot, configPath, legacy: false }
  }
  const sharedConfigPath = path.join(projectRoot, SHARED_CONFIG_FILENAME)
  if (existsSync(sharedConfigPath)) {
    return { projectRoot, configPath: sharedConfigPath, legacy: false }
  }
  const legacyConfigPath = path.join(projectRoot, LEGACY_CONFIG_PATH)
  if (existsSync(legacyConfigPath)) {
    return { projectRoot, configPath: legacyConfigPath, legacy: true }
  }
  return null
}

function configuredRootForConfig(configPath: string): ConfiguredRoot {
  if (path.basename(configPath) === SHARED_CONFIG_FILENAME) {
    return { projectRoot: path.dirname(configPath), configPath, legacy: false }
  }
  const configDirectory = path.dirname(configPath)
  const legacy = path.basename(configDirectory) === path.dirname(LEGACY_CONFIG_PATH)
  return {
    projectRoot: path.dirname(configDirectory),
    configPath,
    legacy,
  }
}

function knowledgeBaseId(workspaceRoot: string, projectRoot: string): string {
  const relativePath = path.relative(workspaceRoot, projectRoot)
  return relativePath.length === 0 ? "." : canonicalSourcePath(relativePath)
}

export interface KnowledgeBaseProfile {
  name: string
  description: string | null
  projectRoot: string
  scopes: Array<{ name: string; description: string | null }>
}

/** Name, purpose, and scopes that tell an agent which project this base answers for. */
export function knowledgeBaseProfile(
  config: Pick<Config, "projectRoot" | "name" | "description" | "scopes">,
): KnowledgeBaseProfile {
  return {
    name: config.name ?? (path.basename(config.projectRoot) || config.projectRoot),
    description: config.description,
    projectRoot: config.projectRoot,
    scopes: Object.entries(config.scopes).map(([name, scope]) => ({
      name,
      description: scope.description ?? null,
    })),
  }
}

/**
 * Synchronous, validation-free read of the profile fields, for building an MCP server whose
 * instructions must exist before the first request. Invalid values fall back to defaults; the
 * validated config still governs every tool call.
 */
export function readKnowledgeBaseProfileSync(projectRoot: string): KnowledgeBaseProfile {
  const raw: Record<string, unknown> = {}
  for (const configPath of [
    path.join(projectRoot, SHARED_CONFIG_FILENAME),
    path.join(projectRoot, CONFIG_PATH),
    path.join(projectRoot, LEGACY_CONFIG_PATH),
  ]) {
    try {
      const value: unknown = JSON.parse(readFileSync(configPath, "utf8"))
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        Object.assign(raw, value)
      }
    } catch {
      // Missing or unreadable files leave the defaults in place.
    }
  }
  const text = (value: unknown): string | null =>
    typeof value === "string" && value.trim().length > 0 ? value.trim() : null
  const scopes =
    typeof raw.scopes === "object" && raw.scopes !== null && !Array.isArray(raw.scopes)
      ? Object.fromEntries(
          Object.entries(raw.scopes as Record<string, unknown>).map(([name, scope]) => [
            name,
            {
              includePaths: [],
              excludePaths: [],
              ...scopeDescription(scope, text),
            },
          ]),
        )
      : {}
  return knowledgeBaseProfile({
    projectRoot,
    name: text(raw.name),
    description: text(raw.description),
    scopes,
  })
}

function scopeDescription(
  scope: unknown,
  text: (value: unknown) => string | null,
): { description?: string } {
  const description =
    typeof scope === "object" && scope !== null && "description" in scope
      ? text((scope as { description?: unknown }).description)
      : null
  return description === null ? {} : { description }
}

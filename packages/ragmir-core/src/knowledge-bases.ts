import { existsSync } from "node:fs"
import path from "node:path"
import fg from "fast-glob"
import { CONFIG_PATH, LEGACY_CONFIG_PATH } from "./defaults.js"
import type { KnowledgeBaseIdentity, KnowledgeBaseInfo, KnowledgeBaseInventory } from "./types.js"

const KNOWLEDGE_BASE_PATTERNS = [
  CONFIG_PATH,
  `**/${CONFIG_PATH}`,
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
  for (const configPath of configPaths.sort()) {
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
  const legacyConfigPath = path.join(projectRoot, LEGACY_CONFIG_PATH)
  if (existsSync(legacyConfigPath)) {
    return { projectRoot, configPath: legacyConfigPath, legacy: true }
  }
  return null
}

function configuredRootForConfig(configPath: string): ConfiguredRoot {
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
  return relativePath.length === 0 ? "." : relativePath.split(path.sep).join("/")
}

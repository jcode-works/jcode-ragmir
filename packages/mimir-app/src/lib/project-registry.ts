const PROJECT_REGISTRY_KEY = "mimir.projectRegistry.v1"
const ACTIVE_PROJECT_KEY = "mimir.activeProjectId.v1"
const WINDOWS_DRIVE_ROOT_PATTERN = /^[A-Za-z]:[\\/]?$/u
const TRAILING_SEPARATOR_PATTERN = /[\\/]+$/u

export type ProjectStatus = "needs-setup" | "ready" | "indexing" | "needs-review"

export interface MimirProject {
  id: string
  name: string
  projectRoot: string
  rawDir: string
  storageDir: string
  filesIndexed: number
  chunksIndexed: number
  progress: number
  status: ProjectStatus
  autoIngestEnabled: boolean
  lastAutoIngestAt: string | null
  updatedAt: string
}

type StoredMimirProject = Omit<MimirProject, "autoIngestEnabled" | "lastAutoIngestAt"> & {
  autoIngestEnabled?: boolean
  lastAutoIngestAt?: string | null
}

export function createProject(input: { projectRoot: string; name?: string }): MimirProject {
  const projectRoot = normalizeProjectRoot(input.projectRoot)
  if (!projectRoot) {
    throw new Error("Project root is required.")
  }

  const now = new Date().toISOString()
  return {
    id: createProjectId(projectRoot),
    name: input.name?.trim() || projectNameFromRoot(projectRoot),
    projectRoot,
    rawDir: joinProjectPath(projectRoot, "private"),
    storageDir: joinProjectPath(projectRoot, ".kb", "storage"),
    filesIndexed: 0,
    chunksIndexed: 0,
    progress: 0,
    status: "needs-setup",
    autoIngestEnabled: false,
    lastAutoIngestAt: null,
    updatedAt: now,
  }
}

export function loadProjects(storage = browserStorage()): MimirProject[] {
  if (!storage) {
    return []
  }

  const raw = storage.getItem(PROJECT_REGISTRY_KEY)
  if (!raw) {
    return []
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter(isStoredMimirProject).map(normalizeStoredProject)
      : []
  } catch {
    return []
  }
}

export function saveProjects(projects: MimirProject[], storage = browserStorage()): void {
  storage?.setItem(PROJECT_REGISTRY_KEY, JSON.stringify(projects))
}

export function loadActiveProjectId(storage = browserStorage()): string | null {
  const activeProjectId = storage?.getItem(ACTIVE_PROJECT_KEY)
  return activeProjectId || null
}

export function saveActiveProjectId(projectId: string | null, storage = browserStorage()): void {
  if (!storage) {
    return
  }
  if (projectId) {
    storage.setItem(ACTIVE_PROJECT_KEY, projectId)
    return
  }
  storage.removeItem(ACTIVE_PROJECT_KEY)
}

export function upsertProject(projects: MimirProject[], project: MimirProject): MimirProject[] {
  const existingIndex = projects.findIndex((entry) => entry.projectRoot === project.projectRoot)
  if (existingIndex < 0) {
    return [project, ...projects]
  }

  return projects.map((entry, index) =>
    index === existingIndex
      ? {
          ...project,
          id: entry.id,
          autoIngestEnabled: entry.autoIngestEnabled,
          lastAutoIngestAt: entry.lastAutoIngestAt,
          updatedAt: project.updatedAt,
        }
      : entry,
  )
}

export function removeProject(projects: MimirProject[], projectId: string): MimirProject[] {
  return projects.filter((project) => project.id !== projectId)
}

export function normalizeProjectRoot(projectRoot: string): string {
  const trimmed = projectRoot.trim()
  if (trimmed === "/" || WINDOWS_DRIVE_ROOT_PATTERN.test(trimmed)) {
    return trimmed
  }
  return trimmed.replace(TRAILING_SEPARATOR_PATTERN, "")
}

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage
}

function createProjectId(projectRoot: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `project-${projectRoot.replace(/[^a-z0-9]+/giu, "-").replace(/^-|-$/gu, "")}`
}

function projectNameFromRoot(projectRoot: string): string {
  const normalized = normalizeProjectRoot(projectRoot)
  const parts = normalized.split(/[\\/]+/u).filter(Boolean)
  return parts.at(-1) || "Mimir project"
}

export function joinProjectPath(projectRoot: string, ...segments: string[]): string {
  const separator = projectRoot.includes("\\") && !projectRoot.includes("/") ? "\\" : "/"
  if (projectRoot === "/") {
    return `${separator}${segments.join(separator)}`
  }
  if (/^[A-Za-z]:$/u.test(projectRoot)) {
    return `${projectRoot}${separator}${segments.join(separator)}`
  }
  return [projectRoot, ...segments].join(separator)
}

function normalizeStoredProject(project: StoredMimirProject): MimirProject {
  return {
    ...project,
    autoIngestEnabled: project.autoIngestEnabled ?? false,
    lastAutoIngestAt: project.lastAutoIngestAt ?? null,
  }
}

function isStoredMimirProject(value: unknown): value is StoredMimirProject {
  if (!isRecord(value)) {
    return false
  }
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.projectRoot === "string" &&
    typeof value.rawDir === "string" &&
    typeof value.storageDir === "string" &&
    typeof value.filesIndexed === "number" &&
    typeof value.chunksIndexed === "number" &&
    typeof value.progress === "number" &&
    isProjectStatus(value.status) &&
    (value.autoIngestEnabled === undefined || typeof value.autoIngestEnabled === "boolean") &&
    (value.lastAutoIngestAt === undefined ||
      value.lastAutoIngestAt === null ||
      typeof value.lastAutoIngestAt === "string") &&
    typeof value.updatedAt === "string"
  )
}

function isProjectStatus(value: unknown): value is ProjectStatus {
  return (
    value === "needs-setup" || value === "ready" || value === "indexing" || value === "needs-review"
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

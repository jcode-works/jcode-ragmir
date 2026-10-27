import { realpathSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { RootsListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js"
import { isCaseInsensitiveFileSystem } from "./source-paths.js"
import type { Config } from "./types.js"

/** Working directory of the agent that launched the server, recorded by the runner and the CLI. */
export const RAGMIR_CLIENT_CWD_ENV = "RAGMIR_CLIENT_CWD"
const ROOTS_TIMEOUT_MS = 2_000

export type WorkspaceRelation = "related" | "unrelated" | "unknown"

export interface WorkspaceScopeVerdict {
  relation: WorkspaceRelation
  /** `mcpAllowedRoots` is configured, so unrelated workspaces are refused instead of warned. */
  enforced: boolean
  allowed: boolean
  workspaceRoots: string[]
  source: "mcp-roots" | "client-environment" | "launch-directory" | null
}

/**
 * Track which workspace the connected agent works in: MCP roots when the client shares them (Claude
 * Code), its CLAUDE_PROJECT_DIR otherwise, and the directory the agent launched the server from
 * (Codex shares neither). A server registered for every project (user scope) would otherwise answer
 * an unrelated project with this base's documents as if they were its own.
 */
export class WorkspaceScope {
  private roots: string[] | null = null
  private source: WorkspaceScopeVerdict["source"] = null
  private pending: Promise<void> | null = null

  constructor(
    private readonly server: Server,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    const clientProject = env.CLAUDE_PROJECT_DIR
    const launchDirectory = env[RAGMIR_CLIENT_CWD_ENV]
    if (clientProject) {
      this.roots = [path.resolve(clientProject)]
      this.source = "client-environment"
    } else if (launchDirectory) {
      this.roots = [path.resolve(launchDirectory)]
      this.source = "launch-directory"
    }
  }

  attach(): void {
    const previous = this.server.oninitialized
    this.server.oninitialized = () => {
      previous?.()
      this.refresh()
    }
    this.server.setNotificationHandler(RootsListChangedNotificationSchema, () => {
      this.refresh()
    })
  }

  refresh(): void {
    if (!this.server.getClientCapabilities()?.roots) {
      return
    }
    this.pending = (async () => {
      try {
        const { roots } = await this.server.listRoots(undefined, { timeout: ROOTS_TIMEOUT_MS })
        const paths = roots.flatMap((root) =>
          root.uri.startsWith("file:") ? [fileURLToPath(root.uri)] : [],
        )
        if (paths.length > 0) {
          this.roots = paths
          this.source = "mcp-roots"
        }
      } catch {
        // Clients may declare roots and still fail to list them; keep the previous evidence.
      }
    })()
  }

  async verdict(config: Config): Promise<WorkspaceScopeVerdict> {
    await this.pending
    const enforced = config.mcpAllowedRoots.length > 0
    const allowedRoots = enforced
      ? config.mcpAllowedRoots.map((root) => resolveAllowedRoot(config.projectRoot, root))
      : [config.projectRoot]
    if (this.roots === null) {
      return { relation: "unknown", enforced, allowed: true, workspaceRoots: [], source: null }
    }
    const caseInsensitive = isCaseInsensitiveFileSystem(config.projectRoot)
    const related = this.roots.some((workspaceRoot) =>
      allowedRoots.some(
        (allowedRoot) =>
          isWithin(workspaceRoot, allowedRoot, caseInsensitive) ||
          isWithin(allowedRoot, workspaceRoot, caseInsensitive),
      ),
    )
    return {
      relation: related ? "related" : "unrelated",
      enforced,
      allowed: related || !enforced,
      workspaceRoots: [...this.roots],
      source: this.source,
    }
  }
}

export function workspaceScopeNotice(
  verdict: WorkspaceScopeVerdict,
  name: string,
  projectRoot: string,
): string | null {
  if (verdict.relation !== "unrelated") {
    return null
  }
  return `Scope notice: this Ragmir server answers from the "${name}" knowledge base (${projectRoot}), not from your workspace (${verdict.workspaceRoots.join(", ")}). Use these passages only for questions about ${name}. Register Ragmir per project, or set mcpAllowedRoots, to keep each workspace on its own base.`
}

export function workspaceScopeRefusal(
  verdict: WorkspaceScopeVerdict,
  name: string,
  config: Config,
): string {
  return `This Ragmir server serves the "${name}" knowledge base only to workspaces under ${config.mcpAllowedRoots.join(", ")} (mcpAllowedRoots). Your workspace is ${verdict.workspaceRoots.join(", ")}. Register a project-scoped Ragmir server for this workspace instead.`
}

function resolveAllowedRoot(projectRoot: string, value: string): string {
  const expanded =
    value === "~" || value.startsWith("~/") || value.startsWith("~\\")
      ? path.join(os.homedir(), value.slice(1))
      : value
  return path.resolve(projectRoot, expanded)
}

function isWithin(child: string, parent: string, caseInsensitive: boolean): boolean {
  const normalize = (value: string): string => {
    const real = realPath(value).normalize("NFC")
    return caseInsensitive ? real.toLowerCase() : real
  }
  const relative = path.relative(normalize(parent), normalize(child))
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function realPath(value: string): string {
  try {
    return realpathSync.native(value)
  } catch {
    return path.resolve(value)
  }
}

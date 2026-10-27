import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { CONFIG_PATH, RAGMIR_PROJECT_ROOT_ENV, SHARED_CONFIG_FILENAME } from "./defaults.js"
import { isRecord } from "./guards.js"
import type { McpRegistrationClient, McpRegistrationScope, McpServerRegistration } from "./types.js"

interface ServerEntry {
  command: string
  args: string[]
  env: Record<string, string>
}

/**
 * Find Ragmir MCP servers registered for this project and for every project, in Claude Code and
 * Codex configuration files. Reads only; a user-scope server answers every workspace from one
 * base, and an unapproved `.mcp.json` server never starts in interactive Claude Code sessions.
 */
export function inspectMcpRegistrations(
  projectRoot: string,
  homeDir: string,
): McpServerRegistration[] {
  const registrations: McpServerRegistration[] = []
  const claudeState = readJson(path.join(homeDir, ".claude.json"))
  for (const [name, entry] of serverEntries(claudeState?.mcpServers)) {
    registrations.push(registration("claude", "user", name, entry))
  }
  const projects = isRecord(claudeState?.projects) ? claudeState.projects : {}
  const projectState = projects[projectRoot]
  if (isRecord(projectState)) {
    for (const [name, entry] of serverEntries(projectState.mcpServers)) {
      registrations.push(registration("claude", "local", name, entry))
    }
  }
  const projectMcp = readJson(path.join(projectRoot, ".mcp.json"))
  const approvals = claudeApprovals(projectRoot, homeDir)
  for (const [name, entry] of serverEntries(projectMcp?.mcpServers)) {
    registrations.push({
      ...registration("claude", "project", name, entry, projectRoot),
      approval: approvals.rejected.has(name)
        ? "rejected"
        : approvals.all || approvals.enabled.has(name)
          ? "approved"
          : "pending",
    })
  }
  for (const [name, entry] of codexServerEntries(path.join(homeDir, ".codex", "config.toml"))) {
    registrations.push(registration("codex", "user", name, entry))
  }
  for (const [name, entry] of codexServerEntries(path.join(projectRoot, ".codex", "config.toml"))) {
    registrations.push(registration("codex", "project", name, entry, projectRoot))
  }
  return registrations.filter((item) => item.servedRoot !== null || isRagmirName(item.name))
}

export function mcpRegistrationWarnings(
  projectRoot: string,
  registrations: readonly McpServerRegistration[],
): string[] {
  const label = (client: McpRegistrationClient): string =>
    client === "claude" ? "Claude Code" : "Codex"
  return registrations.flatMap((item) => {
    if (item.scope === "user") {
      const served =
        item.servedRoot === null
          ? "one knowledge base"
          : item.servedRoot === projectRoot
            ? "this knowledge base"
            : `the knowledge base at ${item.servedRoot}`
      return [
        `${label(item.client)} registers the Ragmir server "${item.name}" for every project (user scope), so agents in unrelated workspaces search ${served}. Register it per project (for example \`claude mcp add --scope project\`) or set mcpAllowedRoots in that base's config.`,
      ]
    }
    if (item.approval === "pending") {
      return [
        `Claude Code has not approved the project MCP server "${item.name}" from .mcp.json, so it does not start in interactive sessions. Approve it when Claude Code asks, or add it to enabledMcpjsonServers in .claude/settings.local.json.`,
      ]
    }
    if (item.approval === "rejected") {
      return [
        `Claude Code disabled the project MCP server "${item.name}" (disabledMcpjsonServers), so agents cannot call Ragmir tools in this project.`,
      ]
    }
    return []
  })
}

function registration(
  client: McpRegistrationClient,
  scope: McpRegistrationScope,
  name: string,
  entry: ServerEntry,
  projectRoot?: string,
): McpServerRegistration {
  return { client, scope, name, servedRoot: servedRoot(entry, projectRoot) }
}

function servedRoot(entry: ServerEntry, projectRoot?: string): string | null {
  const explicit = entry.env[RAGMIR_PROJECT_ROOT_ENV]
  if (explicit) {
    return path.resolve(explicit)
  }
  const flagIndex = entry.args.indexOf("--project-root")
  const flagValue = flagIndex === -1 ? undefined : entry.args[flagIndex + 1]
  if (flagValue) {
    return path.resolve(projectRoot ?? "/", flagValue)
  }
  const commandLine = [entry.command, ...entry.args]
  const runner = commandLine.find((part) => part.replaceAll("\\", "/").endsWith(".ragmir/run.cjs"))
  if (runner) {
    return path.dirname(path.dirname(path.resolve(projectRoot ?? "/", runner)))
  }
  const launchesRagmir = commandLine.some((part) => /serve-mcp|ragmir|(?:^|[\\/])rgr$/iu.test(part))
  if (!launchesRagmir) {
    return null
  }
  // A wrapper script such as scripts/serve-mcp.sh lives inside the base it serves.
  if (path.isAbsolute(entry.command)) {
    const configured = configuredAncestor(path.dirname(entry.command))
    if (configured) {
      return configured
    }
  }
  return projectRoot ?? null
}

function configuredAncestor(start: string): string | null {
  let current = start
  while (true) {
    if (
      existsSync(path.join(current, CONFIG_PATH)) ||
      existsSync(path.join(current, SHARED_CONFIG_FILENAME))
    ) {
      return current
    }
    const parent = path.dirname(current)
    if (parent === current) {
      return null
    }
    current = parent
  }
}

function isRagmirName(name: string): boolean {
  return /ragmir/iu.test(name)
}

function claudeApprovals(
  projectRoot: string,
  homeDir: string,
): { enabled: Set<string>; rejected: Set<string>; all: boolean } {
  const enabled = new Set<string>()
  const rejected = new Set<string>()
  let all = false
  for (const settingsPath of [
    path.join(projectRoot, ".claude", "settings.local.json"),
    path.join(projectRoot, ".claude", "settings.json"),
    path.join(homeDir, ".claude", "settings.json"),
  ]) {
    const settings = readJson(settingsPath)
    for (const name of stringArray(settings?.enabledMcpjsonServers)) enabled.add(name)
    for (const name of stringArray(settings?.disabledMcpjsonServers)) rejected.add(name)
    if (settings?.enableAllProjectMcpServers === true) all = true
  }
  return { enabled, rejected, all }
}

function serverEntries(value: unknown): Array<[string, ServerEntry]> {
  if (!isRecord(value)) {
    return []
  }
  return Object.entries(value).flatMap(([name, entry]) => {
    if (!isRecord(entry) || typeof entry.command !== "string") {
      return []
    }
    return [
      [
        name,
        {
          command: entry.command,
          args: stringArray(entry.args),
          env: isRecord(entry.env)
            ? Object.fromEntries(
                Object.entries(entry.env).filter(
                  (pair): pair is [string, string] => typeof pair[1] === "string",
                ),
              )
            : {},
        },
      ],
    ]
  })
}

/**
 * Minimal reader for `[mcp_servers.<name>]` tables: string `command`, string-array `args`, and the
 * `[mcp_servers.<name>.env]` table. Enough to recognize Ragmir servers without a TOML dependency.
 */
function codexServerEntries(configPath: string): Array<[string, ServerEntry]> {
  let content: string
  try {
    content = readFileSync(configPath, "utf8")
  } catch {
    return []
  }
  const servers = new Map<string, ServerEntry>()
  let current: { name: string; table: "server" | "env" } | null = null
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim()
    const header = /^\[mcp_servers\.("?)([^"\].]+)\1(\.env)?\]$/u.exec(line)
    if (header) {
      const name = header[2] ?? ""
      if (!servers.has(name)) servers.set(name, { command: "", args: [], env: {} })
      current = { name, table: header[3] ? "env" : "server" }
      continue
    }
    if (line.startsWith("[")) {
      current = null
      continue
    }
    const assignment = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/u.exec(line)
    const server = current ? servers.get(current.name) : undefined
    if (!assignment || !server || !current) {
      continue
    }
    const [, key = "", value = ""] = assignment
    if (current.table === "env") {
      const text = tomlString(value)
      if (text !== null) server.env[key] = text
    } else if (key === "command") {
      server.command = tomlString(value) ?? ""
    } else if (key === "args") {
      server.args = tomlStringArray(value)
    }
  }
  return [...servers.entries()].filter(([, entry]) => entry.command.length > 0)
}

function tomlString(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.startsWith("'")) {
    const end = trimmed.indexOf("'", 1)
    return end === -1 ? null : trimmed.slice(1, end)
  }
  if (trimmed.startsWith('"')) {
    try {
      const match = /^"(?:[^"\\]|\\.)*"/u.exec(trimmed)
      return match ? (JSON.parse(match[0]) as string) : null
    } catch {
      return null
    }
  }
  return null
}

function tomlStringArray(value: string): string[] {
  const trimmed = value.trim()
  if (!trimmed.startsWith("[")) {
    return []
  }
  return [...trimmed.matchAll(/"(?:[^"\\]|\\.)*"|'[^']*'/gu)].flatMap((match) => {
    const text = tomlString(match[0])
    return text === null ? [] : [text]
  })
}

function readJson(filePath: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readFileSync(filePath, "utf8"))
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { inspectMcpRegistrations, mcpRegistrationWarnings } from "./mcp-registrations.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe("MCP registrations", () => {
  it("finds user-scope servers, including wrapper scripts inside another base", async () => {
    const home = await tempDir("ragmir-home-")
    const otherBase = await tempDir("ragmir-other-base-")
    const project = await tempDir("ragmir-project-")
    await mkdir(path.join(otherBase, ".ragmir"), { recursive: true })
    await mkdir(path.join(otherBase, "scripts"), { recursive: true })
    await writeFile(path.join(otherBase, ".ragmir", "config.json"), "{}\n")
    await writeFile(
      path.join(home, ".claude.json"),
      JSON.stringify({
        mcpServers: {
          "knowledge-base": { command: path.join(otherBase, "scripts", "serve-mcp.sh"), args: [] },
          docs: { command: "npx", args: ["some-other-server"] },
        },
      }),
    )
    await mkdir(path.join(home, ".codex"), { recursive: true })
    await writeFile(
      path.join(home, ".codex", "config.toml"),
      [
        "[mcp_servers.ragmir-project]",
        'command = "node"',
        `args = ["${path.join(project, ".ragmir", "run.cjs").replaceAll("\\", "\\\\")}", "serve-mcp"]`,
        "",
        "[mcp_servers.ragmir-project.env]",
        `RAGMIR_PROJECT_ROOT = '${project}'`,
        "",
        "[mcp_servers.unrelated]",
        'command = "uvx"',
      ].join("\n"),
    )

    const registrations = inspectMcpRegistrations(project, home)

    expect(registrations).toEqual([
      { client: "claude", scope: "user", name: "knowledge-base", servedRoot: otherBase },
      { client: "codex", scope: "user", name: "ragmir-project", servedRoot: project },
    ])
    const warnings = mcpRegistrationWarnings(project, registrations)
    expect(warnings[0]).toContain(`search the knowledge base at ${otherBase}`)
    expect(warnings[1]).toContain("Codex registers the Ragmir server")
    expect(warnings[1]).toContain("search this knowledge base")
  })

  it("reports project servers that Claude Code has not approved or has disabled", async () => {
    const home = await tempDir("ragmir-home-")
    const project = await tempDir("ragmir-project-")
    await writeFile(
      path.join(project, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          ragmir: { command: "node", args: [".ragmir/run.cjs", "serve-mcp"] },
          "ragmir-docs": { command: "node", args: [".ragmir/run.cjs", "serve-mcp"] },
          capawesome: { command: "npx", args: ["capawesome-mcp"] },
        },
      }),
    )
    await mkdir(path.join(project, ".claude"), { recursive: true })
    await writeFile(
      path.join(project, ".claude", "settings.local.json"),
      JSON.stringify({ disabledMcpjsonServers: ["ragmir-docs"] }),
    )

    const registrations = inspectMcpRegistrations(project, home)

    expect(registrations).toEqual([
      {
        client: "claude",
        scope: "project",
        name: "ragmir",
        servedRoot: project,
        approval: "pending",
      },
      {
        client: "claude",
        scope: "project",
        name: "ragmir-docs",
        servedRoot: project,
        approval: "rejected",
      },
    ])
    const warnings = mcpRegistrationWarnings(project, registrations)
    expect(warnings[0]).toContain('has not approved the project MCP server "ragmir"')
    expect(warnings[1]).toContain('disabled the project MCP server "ragmir-docs"')

    await writeFile(
      path.join(project, ".claude", "settings.local.json"),
      JSON.stringify({ enabledMcpjsonServers: ["ragmir"] }),
    )
    expect(inspectMcpRegistrations(project, home)[0]).toMatchObject({ approval: "approved" })
  })
})

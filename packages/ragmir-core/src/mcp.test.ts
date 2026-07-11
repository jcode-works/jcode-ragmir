import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { projectRelativeGoldenPath, resolveMcpProjectRoot, searchOptions } from "./mcp.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("resolveMcpProjectRoot", () => {
  it("prefers explicit Ragmir roots, then configured cwd roots, then Claude Code project roots", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-mcp-root-"))
    tempDirs.push(root)
    const nested = path.join(root, "nested")
    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    await mkdir(nested, { recursive: true })
    await writeFile(path.join(root, ".ragmir", "config.json"), "{}\n", "utf8")

    expect(
      resolveMcpProjectRoot(
        {
          RAGMIR_PROJECT_ROOT: "/repo/ragmir",
          CLAUDE_PROJECT_DIR: "/repo/claude",
        },
        "/repo/cwd",
      ),
    ).toBe("/repo/ragmir")
    expect(resolveMcpProjectRoot({ CLAUDE_PROJECT_DIR: "/repo/claude" }, nested)).toBe(root)
    expect(resolveMcpProjectRoot({ CLAUDE_PROJECT_DIR: "/repo/claude" }, "/repo/cwd")).toBe(
      "/repo/claude",
    )
    expect(resolveMcpProjectRoot({}, "/repo/cwd")).toBe("/repo/cwd")
  })
})

describe("searchOptions", () => {
  it("clamps requested topK to the configured mcpMaxTopK", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-mcp-topk-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir", "config.json"),
      JSON.stringify({ mcpMaxTopK: 5, topK: 8 }),
      "utf8",
    )

    expect((await searchOptions(root, 50)).topK).toBe(5)
    expect((await searchOptions(root, 2)).topK).toBe(2)
    expect((await searchOptions(root, undefined)).topK).toBe(5)
    expect((await searchOptions(root, 2, 20)).contextRadius).toBe(3)
    expect(
      await searchOptions(root, 2, 1, [".ragmir/raw/primary"], [".ragmir/raw/research"]),
    ).toEqual({
      cwd: root,
      topK: 2,
      contextRadius: 1,
      includePaths: [".ragmir/raw/primary"],
      excludePaths: [".ragmir/raw/research"],
    })
  })
})

describe("projectRelativeGoldenPath", () => {
  it("keeps paths inside the project root and rejects traversal", () => {
    expect(projectRelativeGoldenPath("/repo", "eval/golden.json")).toBe(
      path.join("eval", "golden.json"),
    )
    expect(() => projectRelativeGoldenPath("/repo", "../secrets.json")).toThrow(
      "must stay inside the MCP project root",
    )
    expect(() => projectRelativeGoldenPath("/repo", "/etc/passwd")).toThrow(
      "must stay inside the MCP project root",
    )
  })
})

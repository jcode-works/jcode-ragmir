import { describe, expect, it } from "vitest"
import { resolveMcpProjectRoot } from "./mcp.js"

describe("resolveMcpProjectRoot", () => {
  it("prefers explicit Mimir roots, then Claude Code project roots, then cwd", () => {
    expect(
      resolveMcpProjectRoot(
        {
          MIMIR_PROJECT_ROOT: "/repo/mimir",
          CLAUDE_PROJECT_DIR: "/repo/claude",
        },
        "/repo/cwd",
      ),
    ).toBe("/repo/mimir")
    expect(resolveMcpProjectRoot({ CLAUDE_PROJECT_DIR: "/repo/claude" }, "/repo/cwd")).toBe(
      "/repo/claude",
    )
    expect(resolveMcpProjectRoot({}, "/repo/cwd")).toBe("/repo/cwd")
  })
})

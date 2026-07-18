import { describe, expect, it } from "vitest"
import { type FastCliIo, runFastCli } from "./cli-fast.js"
import { DEFAULT_CLI_STDIN_MAX_BYTES, readBoundedStdin } from "./cli-stdin.js"
import { VERSION } from "./version.js"

describe("runFastCli", () => {
  it("should return the version without loading a heavy command when version is requested", async () => {
    const output = captureIo()

    const result = await runFastCli(["--version"], "/project/rgr", output.io)

    expect(result).toEqual({ handled: true, exitCode: 0 })
    expect(output.stdout()).toBe(`${VERSION}\n`)
  })

  it("should route a prompt when JSON output is requested", async () => {
    const output = captureIo()

    const result = await runFastCli(
      ["route-prompt", "--json", "find", "indexed", "architecture", "evidence"],
      "/project/rgr",
      output.io,
    )

    expect(result).toEqual({ handled: true, exitCode: 0 })
    expect(JSON.parse(output.stdout())).toEqual(
      expect.objectContaining({ shouldUseRagmir: true, tool: "ragmir_research" }),
    )
  })

  it("should read a route prompt from bounded stdin when arguments are omitted", async () => {
    const output = captureIo(["find cited local evidence"])

    const result = await runFastCli(["route-prompt"], "/project/rgr", output.io)

    expect(result).toEqual({ handled: true, exitCode: 0 })
    expect(output.stdout()).toContain("shouldUseRagmir=true")
  })

  it("should delegate commands outside the lightweight routing path", async () => {
    const output = captureIo()

    const result = await runFastCli(["search", "evidence"], "/project/rgr", output.io)

    expect(result).toEqual({ handled: false })
  })

  it("should delegate an unsupported global option to Commander", async () => {
    const output = captureIo()

    const result = await runFastCli(
      ["--unsupported", "route-prompt", "evidence"],
      "/project/rgr",
      output.io,
    )

    expect(result).toEqual({ handled: false })
  })

  it("should reject stdin when the configured byte limit is exceeded", async () => {
    const input = asyncValues(["x".repeat(DEFAULT_CLI_STDIN_MAX_BYTES + 1)])

    await expect(readBoundedStdin(input)).rejects.toThrow("Standard input exceeds")
  })
})

function captureIo(stdinValues: string[] = []): {
  io: FastCliIo
  stdout: () => string
  stderr: () => string
} {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    io: {
      stdin: asyncValues(stdinValues),
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    },
    stdout: () => stdout.join(""),
    stderr: () => stderr.join(""),
  }
}

async function* asyncValues(values: string[]): AsyncGenerator<string> {
  for (const value of values) {
    yield value
  }
}

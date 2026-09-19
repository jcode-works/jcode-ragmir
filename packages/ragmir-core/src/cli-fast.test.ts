import { describe, expect, it } from "vitest"
import { runFastCli } from "./cli-fast.js"
import { VERSION } from "./version.js"

describe("runFastCli", () => {
  it.each([
    ["--version"],
    ["-V"],
    ["--project-root", "/project", "--version"],
    ["--project-root=/project", "-V"],
  ])(
    "should return the version without loading the command runtime when passed %j",
    async (...args) => {
      const output: string[] = []
      expect(await runFastCli(args, { stdout: (text) => output.push(text) })).toEqual({
        handled: true,
        exitCode: 0,
      })
      expect(output.join("")).toBe(`${VERSION}\n`)
    },
  )
  it.each([["search", "evidence"], ["--unsupported"], ["--project-root"], []])(
    "should delegate to Commander when arguments are %j",
    async (...args) => {
      expect(await runFastCli(args)).toEqual({ handled: false })
    },
  )
})

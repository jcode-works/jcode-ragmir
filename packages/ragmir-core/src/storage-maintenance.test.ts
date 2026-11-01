import { describe, expect, it } from "vitest"
import { fragmentationWarning } from "./storage-maintenance.js"

const run = (args: string[]): string => `rgr ${args.join(" ")}`

describe("fragmentationWarning", () => {
  it("should advise compaction for an index left in many small fragments", () => {
    expect(fragmentationWarning({ total: 709, small: 709, smallRatio: 1 }, run)).toBe(
      "The index is split into 709 table fragments, which slows every search. Run `rgr storage optimize` to compact it.",
    )
  })

  it("should stay silent for a compact index, mostly large fragments, or no snapshot", () => {
    expect(fragmentationWarning({ total: 9, small: 9, smallRatio: 1 }, run)).toBeNull()
    expect(fragmentationWarning({ total: 120, small: 12, smallRatio: 0.1 }, run)).toBeNull()
    expect(fragmentationWarning(undefined, run)).toBeNull()
  })
})

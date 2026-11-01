import { describe, expect, it, vi } from "vitest"
import { memoizeByText } from "./text-memo.js"

describe("memoizeByText", () => {
  it("computes once per text and forgets the oldest text beyond its capacity", () => {
    const compute = vi.fn((text: string) => text.length)
    const memo = memoizeByText(compute, 2)

    expect([memo("alpha"), memo("alpha"), memo("beta"), memo("gamma"), memo("alpha")]).toEqual([
      5, 5, 4, 5, 5,
    ])
    expect(compute.mock.calls.map(([text]) => text)).toEqual(["alpha", "beta", "gamma", "alpha"])
  })
})

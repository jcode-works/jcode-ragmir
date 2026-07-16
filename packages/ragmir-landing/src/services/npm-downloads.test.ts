import { afterEach, describe, expect, it, vi } from "vitest"
import { getMonthlyNpmDownloads } from "./npm-downloads.js"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("getMonthlyNpmDownloads", () => {
  it("should use a valid environment override without calling npm", async () => {
    vi.stubEnv("RAGMIR_NPM_DOWNLOADS", "1234")
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(getMonthlyNpmDownloads()).resolves.toBe(1_234)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("should return the package download count for a valid npm response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ downloads: 321, package: "@jcode.labs/ragmir" }, { status: 200 }),
      ),
    )

    await expect(getMonthlyNpmDownloads()).resolves.toBe(321)
  })

  it("should return null for HTTP errors and invalid payloads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ downloads: -1, package: "wrong" }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(getMonthlyNpmDownloads()).resolves.toBeNull()
    await expect(getMonthlyNpmDownloads()).resolves.toBeNull()
  })

  it("should abort a stalled npm request after the timeout", async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_input: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
              once: true,
            })
          }),
      ),
    )

    const downloads = getMonthlyNpmDownloads()
    await vi.advanceTimersByTimeAsync(5_000)

    await expect(downloads).resolves.toBeNull()
  })
})

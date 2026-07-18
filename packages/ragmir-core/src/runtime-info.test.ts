import { describe, expect, it } from "vitest"
import { runtimeInfo } from "./runtime-info.js"

describe("runtimeInfo", () => {
  it("should report resolved runtime and native dependency versions", () => {
    const report = runtimeInfo()

    expect(report).toMatchObject({
      node: process.versions.node,
      platform: process.platform,
      architecture: process.arch,
      dependencies: {
        lanceDb: { name: "@lancedb/lancedb", version: expect.any(String) },
        lanceDbNative: { version: expect.any(String) },
        apacheArrow: { name: "apache-arrow", version: expect.any(String) },
        transformers: { name: "@huggingface/transformers", version: expect.any(String) },
        onnxRuntime: { name: "onnxruntime-node", version: expect.any(String) },
        sharp: { name: "sharp", version: expect.any(String) },
      },
    })
    expect(report.napi).toMatch(/^\d+$/u)
  })
})

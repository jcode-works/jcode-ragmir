import { describe, expect, it } from "vitest"
import { indexPolicyFingerprint } from "./index-policy.js"
import { testConfig } from "./test-support/config.js"

describe("indexPolicyFingerprint", () => {
  it("should include the active PDF OCR parser policy", () => {
    const withoutOcr = testConfig({ pdfOcrCommand: [] })
    const withOcr = testConfig({ pdfOcrCommand: ["rgr", "ocr", "extract-pages", "{pages}"] })

    expect(indexPolicyFingerprint(withOcr)).not.toBe(indexPolicyFingerprint(withoutOcr))
    expect(
      indexPolicyFingerprint({
        ...withOcr,
        pdfOcrCommand: ["rgr", "ocr", "extract-pages", "--language", "fra", "{pages}"],
      }),
    ).not.toBe(indexPolicyFingerprint(withOcr))
  })
})

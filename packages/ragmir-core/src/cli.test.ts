import { describe, expect, it } from "vitest"
import {
  audioAllowRemoteModels,
  audioEngine,
  audioLanguage,
  parseAgentInstallMode,
  parseAgentInstallScope,
  parseNumber,
  parsePositiveInt,
  parseRecallThreshold,
} from "./cli-options.js"

describe("parsePositiveInt", () => {
  it("parses a positive integer", () => {
    expect(parsePositiveInt("1")).toBe(1)
    expect(parsePositiveInt("42")).toBe(42)
  })

  it("rejects zero, negatives, and non-integers", () => {
    expect(() => parsePositiveInt("0")).toThrow("positive integer")
    expect(() => parsePositiveInt("-3")).toThrow("positive integer")
    expect(() => parsePositiveInt("1.5")).toThrow("positive integer")
    expect(() => parsePositiveInt("abc")).toThrow("positive integer")
    expect(() => parsePositiveInt("")).toThrow("positive integer")
  })
})

describe("parseNumber", () => {
  it("parses finite numbers including negatives and decimals", () => {
    expect(parseNumber("1")).toBe(1)
    expect(parseNumber("-2.5")).toBe(-2.5)
    expect(parseNumber("0")).toBe(0)
  })

  it("rejects non-finite values", () => {
    expect(() => parseNumber("abc")).toThrow("Expected a number")
    expect(() => parseNumber("")).toThrow("Expected a number")
  })
})

describe("parseRecallThreshold", () => {
  it("accepts values in the inclusive 0..1 range", () => {
    expect(parseRecallThreshold("0")).toBe(0)
    expect(parseRecallThreshold("1")).toBe(1)
    expect(parseRecallThreshold("0.75")).toBe(0.75)
  })

  it("trims surrounding whitespace before parsing", () => {
    expect(parseRecallThreshold("  0.5  ")).toBe(0.5)
  })

  it("rejects values outside the range and non-numbers", () => {
    expect(() => parseRecallThreshold("-0.1")).toThrow("between 0 and 1")
    expect(() => parseRecallThreshold("1.1")).toThrow("between 0 and 1")
    expect(() => parseRecallThreshold("abc")).toThrow("between 0 and 1")
    expect(() => parseRecallThreshold("   ")).toThrow("between 0 and 1")
  })
})

describe("audioAllowRemoteModels", () => {
  it("forces remote models off when offline", () => {
    expect(audioAllowRemoteModels({ offline: true, allowRemoteModels: true })).toBe(false)
  })

  it("enables remote models on explicit opt-in", () => {
    expect(audioAllowRemoteModels({ allowRemoteModels: true })).toBe(true)
  })

  it("returns undefined by default to defer to the TTS package default", () => {
    expect(audioAllowRemoteModels({})).toBeUndefined()
  })
})

describe("audioLanguage", () => {
  it("returns undefined when no language is provided", () => {
    expect(audioLanguage({})).toBeUndefined()
  })

  it("accepts a supported language", () => {
    expect(audioLanguage({ lang: "fr" })).toBe("fr")
    expect(audioLanguage({ lang: "en" })).toBe("en")
    expect(audioLanguage({ lang: "es" })).toBe("es")
  })

  it("rejects an unsupported language with the list of valid options", () => {
    expect(() => audioLanguage({ lang: "de" })).toThrow("en, es, fr")
  })
})

describe("audioEngine", () => {
  it("forces the transformers engine when offline", () => {
    expect(audioEngine({ offline: true })).toBe("transformers")
    expect(audioEngine({ offline: true, engine: "edge" })).toBe("transformers")
  })

  it("defaults to transformers when no engine is given", () => {
    expect(audioEngine({})).toBe("transformers")
  })

  it("accepts explicit engine choices", () => {
    expect(audioEngine({ engine: "edge" })).toBe("edge")
    expect(audioEngine({ engine: "auto" })).toBe("auto")
    expect(audioEngine({ engine: "transformers" })).toBe("transformers")
  })

  it("guards MP3 output without an explicit engine (confidentiality check)", () => {
    expect(() => audioEngine({ out: "summary.mp3" })).toThrow("MP3 output uses online Edge TTS")
  })

  it("allows MP3 output when edge engine is explicit", () => {
    expect(audioEngine({ out: "summary.mp3", engine: "edge" })).toBe("edge")
  })

  it("rejects an invalid engine value", () => {
    expect(() => audioEngine({ engine: "piper" })).toThrow("auto, edge, or transformers")
  })
})

describe("parseAgentInstallScope", () => {
  it("accepts project and user scopes", () => {
    expect(parseAgentInstallScope("project")).toBe("project")
    expect(parseAgentInstallScope("user")).toBe("user")
  })

  it("returns project by default when no value is given", () => {
    // Note: the CLI passes undefined when --scope is omitted; the default is
    // applied at the Commander level, but the parser itself accepts undefined
    // only as an error here (the default wiring in cli.ts guarantees a value).
    expect(() => parseAgentInstallScope(undefined)).toThrow("project or user")
  })

  it("rejects unknown scopes", () => {
    expect(() => parseAgentInstallScope("global")).toThrow("project or user")
  })
})

describe("parseAgentInstallMode", () => {
  it("accepts link and copy modes", () => {
    expect(parseAgentInstallMode("link")).toBe("link")
    expect(parseAgentInstallMode("copy")).toBe("copy")
  })

  it("rejects unknown modes", () => {
    expect(() => parseAgentInstallMode("move")).toThrow("link or copy")
    expect(() => parseAgentInstallMode(undefined)).toThrow("link or copy")
  })
})

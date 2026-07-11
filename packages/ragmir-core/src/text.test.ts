import { describe, expect, it } from "vitest"
import { normalizeForMatch, tokenize } from "./text.js"

describe("normalizeForMatch", () => {
  it("lowercases and strips diacritics for foldable matching", () => {
    expect(normalizeForMatch("Café Élève Nîme")).toBe("cafe eleve nime")
  })

  it("leaves ASCII text unchanged aside from casing", () => {
    expect(normalizeForMatch("Plain ASCII 123")).toBe("plain ascii 123")
  })

  it("is stable on empty input", () => {
    expect(normalizeForMatch("")).toBe("")
  })
})

describe("tokenize", () => {
  it("keeps only alphanumeric runs of two or more characters", () => {
    expect(tokenize("The quick brown fox.")).toEqual(["the", "quick", "brown", "fox"])
  })

  it("drops single-character tokens", () => {
    expect(tokenize("a I x 1 9")).toEqual([])
  })

  it("strips diacritics before tokenizing so accented words fold together", () => {
    expect(tokenize("café Café CAFE")).toEqual(["cafe", "cafe", "cafe"])
  })

  it("treats punctuation and symbols as delimiters, not tokens", () => {
    expect(tokenize("hello, world! @user #tag")).toEqual(["hello", "world", "user", "tag"])
  })

  it("returns an empty array for input with no alphanumeric runs", () => {
    expect(tokenize("--- ... !!! ???")).toEqual([])
  })

  it("returns an empty array for empty input", () => {
    expect(tokenize("")).toEqual([])
  })

  it("keeps CJK characters as tokens", () => {
    const tokens = tokenize("文档 检索")
    expect(tokens.join("")).toBe("文档检索")
    expect(tokens.length).toBeGreaterThan(1)
  })

  it("segments Thai words instead of collapsing a sentence into one token", () => {
    const first = tokenize("เอกสารลับต้องเก็บไว้ในเครื่อง")
    const second = tokenize("นโยบายสาธารณะสำหรับทีม")

    expect(first.length).toBeGreaterThan(1)
    expect(second.length).toBeGreaterThan(1)
    expect(first).not.toEqual(second)
  })

  it("keeps numeric runs", () => {
    expect(tokenize("version 1024 and build 7g")).toEqual(["version", "1024", "and", "build", "7g"])
  })
})

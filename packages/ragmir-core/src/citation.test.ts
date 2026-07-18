import { describe, expect, it } from "vitest"
import { citationForCoordinates, stripCitationCoordinates } from "./citation.js"

describe("citation coordinates", () => {
  it.each([
    {
      coordinates: {
        relativePath: "brief.pdf",
        chunkIndex: 2,
        pageStart: 3,
        pageEnd: 3,
      },
      citation: "brief.pdf:p3#2",
    },
    {
      coordinates: {
        relativePath: "deck.pptx",
        chunkIndex: 4,
        locationKind: "slide" as const,
        locationStart: 12,
        locationEnd: 12,
      },
      citation: "deck.pptx:slide12#4",
    },
    {
      coordinates: {
        relativePath: "data.xlsx",
        chunkIndex: 1,
        locationKind: "sheet" as const,
        locationStart: 2,
        locationEnd: 2,
        locationLabel: "Finance & Ops",
        cellStart: "A7",
        cellEnd: "D7",
      },
      citation: "data.xlsx:sheet=Finance%20%26%20Ops:cells=A7-D7#1",
    },
    {
      coordinates: {
        relativePath: "book.epub",
        chunkIndex: 0,
        locationKind: "epub" as const,
        locationStart: 2,
        locationEnd: 2,
      },
      citation: "book.epub:spine2#0",
    },
    {
      coordinates: {
        relativePath: "notes.md",
        chunkIndex: 3,
        lineStart: 10,
        lineEnd: 12,
      },
      citation: "notes.md:L10-L12#3",
    },
  ])("should render and strip $citation", ({ coordinates, citation }) => {
    expect(citationForCoordinates(coordinates)).toBe(citation)
    expect(stripCitationCoordinates(citation.slice(0, citation.lastIndexOf("#")))).toBe(
      coordinates.relativePath,
    )
  })

  it("should omit unverifiable line coordinates", () => {
    expect(
      citationForCoordinates({
        relativePath: "transformed.yaml",
        chunkIndex: 0,
        lineStart: 0,
        lineEnd: 0,
      }),
    ).toBe("transformed.yaml#0")
  })
})

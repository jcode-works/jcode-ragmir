import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import en from "../messages/en.json"
import fr from "../messages/fr.json"
import { findHeroDemoScenario, HERO_DEMO_SCENARIOS } from "./components/hero-demo-script.js"
import { getLocalizedUrl, loadTranslations, useTranslations } from "./i18n/utils.js"
import { cn } from "./lib/utils.js"

const homePageSource = readFileSync(
  fileURLToPath(new URL("./pages/[...locale]/index.astro", import.meta.url)),
  "utf8",
)
const teamPageSource = readFileSync(
  fileURLToPath(new URL("./pages/[...locale]/team.astro", import.meta.url)),
  "utf8",
)
const heroSource = readFileSync(
  fileURLToPath(new URL("./components/sections/hero.astro", import.meta.url)),
  "utf8",
)
const localizedWebPageId = /"@id": `\$\{pageUrl\}#webpage`/

describe("landing public contract", () => {
  it("should keep English and French translation keys in parity", () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort())
  })

  it("should keep a prominent headline and one concise, neutral-color description", () => {
    expect(en.hero_title).toBe("Confidential local RAG for your coding agents.")
    expect(fr.hero_title).toBe("Un RAG local et confidentiel pour vos agents de code.")
    expect(en.hero_description).toContain("Ragmir turns specs")
    expect(fr.hero_description).toContain("Ragmir transforme les spécifications")
    expect(heroSource).toContain('{t("hero_title")}')
    expect(heroSource).toContain('{t("hero_description")}')
    expect(heroSource).not.toContain("hero_title_line")
    expect(heroSource).not.toContain("hero_subtagline")
    expect(heroSource).not.toContain("text-[var(--accent-title)]")
  })

  it("should lead homepage metadata with the library, CLI, and local MCP server", () => {
    expect(en.seo_home_title).toContain("RAG library")
    expect(fr.seo_home_title).toContain("bibliothèque RAG")
    expect(en.seo_home_description).toContain("TypeScript RAG library, CLI, and local MCP server")
    expect(fr.seo_home_description).toContain(
      "Bibliothèque TypeScript open source, CLI et serveur MCP local",
    )
    expect(en.hero_metric_mcp_value).toBe("Library + CLI + MCP")
    expect(fr.hero_metric_mcp_value).toBe("Bibliothèque + CLI + MCP")
    expect(en.seo_home_keywords).not.toContain("local RAG API")
    expect(fr.seo_home_keywords).not.toContain("API RAG locale")
  })

  it("should keep shared entities stable and give each localized home page its own WebPage", () => {
    expect(homePageSource).toContain('inLanguage: ["en", "fr"]')
    expect(homePageSource).toContain("url: siteUrl")
    expect(homePageSource).toContain('"@type": "WebPage"')
    expect(homePageSource).toMatch(localizedWebPageId)
    expect(homePageSource).toContain('about: { "@id": "https://ragmir.com/#source" }')
    expect(teamPageSource).toContain('url: "https://github.com/jb-thery"')
  })

  it("should provide every localized key referenced by hero scenarios", () => {
    const referencedKeys = HERO_DEMO_SCENARIOS.flatMap((scenario) => [
      scenario.titleKey,
      scenario.descriptionKey,
      scenario.badgeKey,
      ...scenario.lines.flatMap((line) => ("textKey" in line ? [line.textKey] : [])),
    ]).filter((key): key is string => typeof key === "string")

    expect(referencedKeys.every((key) => key in en && key in fr)).toBe(true)
  })

  it("should fall back to the default hero scenario for an unknown id", () => {
    expect(findHeroDemoScenario("unknown")).toBe(HERO_DEMO_SCENARIOS[0])
  })

  it("should show only verifiable coordinates in public citation examples", () => {
    const citations = HERO_DEMO_SCENARIOS.flatMap((scenario) =>
      scenario.lines.flatMap((line) => (line.kind === "citation" && line.text ? [line.text] : [])),
    )

    expect(citations.some((citation) => /\.(?:docx|xlsx).*:L\d+/u.test(citation))).toBe(false)
    expect(citations.some((citation) => /\.pdf:p\d+:L\d+/u.test(citation))).toBe(false)
    expect(
      citations
        .filter((citation) => citation.includes(".xlsx"))
        .every((citation) => /:sheet=[^:]+:cells=[A-Z]+\d+(?:-[A-Z]+\d+)?#/u.test(citation)),
    ).toBe(true)
  })

  it("should explain the team workflow positively and concisely in both locales", () => {
    expect(en.faq_team_answer).toContain("corpus fingerprint")
    expect(fr.faq_team_answer).toContain("empreinte du corpus")
    for (const answer of [en.faq_team_answer, fr.faq_team_answer]) {
      expect(answer).toContain("Git")
      expect(answer.length).toBeLessThan(500)
    }
  })

  it("should normalize localized internal URLs and preserve external URLs", () => {
    expect([
      getLocalizedUrl("team", "en"),
      getLocalizedUrl("/team", "fr"),
      getLocalizedUrl("https://example.com/path", "fr"),
    ]).toEqual(["/team/", "/fr/team/", "https://example.com/path"])
  })

  it("should fall back to English translations for an unsupported locale", async () => {
    const translations = await loadTranslations("de")
    const localized = await useTranslations("de")

    expect(translations).toEqual(en)
    expect(localized.locale).toBe("en")
    expect(localized.t("nav_github")).toBe(en.nav_github)
    expect(localized.t("missing_key")).toBe("missing_key")
  })

  it("should merge conditional and conflicting utility classes", () => {
    expect(cn("px-2", false && "hidden", "px-4")).toBe("px-4")
  })
})

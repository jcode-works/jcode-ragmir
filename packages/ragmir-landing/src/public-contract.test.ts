import { describe, expect, it } from "vitest"
import en from "../messages/en.json"
import fr from "../messages/fr.json"
import { findHeroDemoScenario, HERO_DEMO_SCENARIOS } from "./components/hero-demo-script.js"
import { getLocalizedUrl, loadTranslations, useTranslations } from "./i18n/utils.js"
import { cn } from "./lib/utils.js"

describe("landing public contract", () => {
  it("should keep English and French translation keys in parity", () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort())
  })

  it("should keep the public secondary tagline exact in both locales", () => {
    expect(en.hero_subtagline).toBe("Stop sending confidential documents directly to the cloud.")
    expect(fr.hero_subtagline).toBe(
      "Arrêtez d'envoyer les documents confidentiels directement dans le cloud.",
    )
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

  it("should document the team corpus equivalence safeguards in both locales", () => {
    expect(en.faq_team_answer).toContain("corpus fingerprint")
    expect(fr.faq_team_answer).toContain("empreinte du corpus")
    for (const answer of [en.faq_team_answer, fr.faq_team_answer]) {
      expect(answer).toContain("sourceFingerprintMode")
      expect(answer).toContain(".ragmir/storage")
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

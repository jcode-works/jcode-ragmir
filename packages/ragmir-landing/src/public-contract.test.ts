import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import en from "../messages/en.json"
import fr from "../messages/fr.json"
import { findHeroDemoScenario, HERO_DEMO_SCENARIOS } from "./components/hero-demo-script.js"
import { getFaqItems } from "./content/faq.js"
import { RAGMIR_SETUP_PROMPT } from "./content/setup-prompt.js"
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
const librarySource = readFileSync(
  fileURLToPath(new URL("./components/library-section.tsx", import.meta.url)),
  "utf8",
)
const buttonSource = readFileSync(
  fileURLToPath(new URL("./components/ui/button.tsx", import.meta.url)),
  "utf8",
)
const cardSource = readFileSync(
  fileURLToPath(new URL("./components/ui/card.tsx", import.meta.url)),
  "utf8",
)
const commandCopySource = readFileSync(
  fileURLToPath(new URL("./components/command-copy.tsx", import.meta.url)),
  "utf8",
)
const closingCtaSource = readFileSync(
  fileURLToPath(new URL("./components/sections/closing-cta.astro", import.meta.url)),
  "utf8",
)
const footerSource = readFileSync(
  fileURLToPath(new URL("./components/sections/footer.astro", import.meta.url)),
  "utf8",
)
const textareaSource = readFileSync(
  fileURLToPath(new URL("./components/ui/textarea.tsx", import.meta.url)),
  "utf8",
)
const coreCliSource = readFileSync(
  fileURLToPath(new URL("../../ragmir-core/src/cli.ts", import.meta.url)),
  "utf8",
)
const coreMcpSource = readFileSync(
  fileURLToPath(new URL("../../ragmir-core/src/mcp.ts", import.meta.url)),
  "utf8",
)
const localizedWebPageId = /"@id": `\$\{pageUrl\}#webpage`/

function collectUiSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return collectUiSourceFiles(entryPath)
    return /\.(?:astro|css|tsx)$/u.test(entry.name) ? [entryPath] : []
  })
}

describe("landing public contract", () => {
  it("should keep English and French translation keys in parity", () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort())
  })

  it("should keep a prominent outlined headline on three localized lines", () => {
    expect(en.hero_title).toBe("Confidential local RAG for your coding agents.")
    expect(fr.hero_title).toBe("Un RAG local et confidentiel pour vos agents de code.")
    expect([en.hero_title_line_1, en.hero_title_line_2, en.hero_title_line_3]).toEqual([
      "Confidential local",
      "RAG for your",
      "coding agents.",
    ])
    expect([fr.hero_title_line_1, fr.hero_title_line_2, fr.hero_title_line_3]).toEqual([
      "Un RAG local",
      "et confidentiel pour",
      "vos agents de code.",
    ])
    expect(en.hero_description).toContain("Ragmir turns specs")
    expect(fr.hero_description).toContain("Ragmir transforme les spécifications")
    expect(heroSource).toContain('aria-label={t("hero_title")}')
    expect(heroSource).toContain("hero-title-outline")
    expect(heroSource).toContain("heroTitleLines.map")
    expect(heroSource).toContain('{t("hero_description")}')
    expect(heroSource).not.toContain("hero_subtagline")
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

  it("should present the bounded agent setup prompt before manual package-manager tabs", () => {
    expect(RAGMIR_SETUP_PROMPT.length).toBeLessThanOrEqual(4_000)
    expect(RAGMIR_SETUP_PROMPT).toContain("pnpm, npm, Yarn, or Bun")
    expect(RAGMIR_SETUP_PROMPT).toContain("Core only, or optional Chat")
    expect(RAGMIR_SETUP_PROMPT).toContain("Optional TTS")
    expect(librarySource).toContain('defaultValue="prompt"')
    expect(librarySource.indexOf('t("quickstart_prompt_tab")')).toBeLessThan(
      librarySource.indexOf("packageManagers.map((manager)"),
    )
    expect(librarySource).toContain("<Textarea")
    expect(librarySource).toContain("readOnly")
    expect(librarySource).toContain("overflow-y-auto")
    expect(librarySource).toContain('className="h-[4.125rem] min-h-[4.125rem]')
    expect(librarySource).toContain("outline-1 outline-border/70 outline-solid")
  })

  it("should round actions and cards while keeping copy inputs compact", () => {
    const sourceDirectory = fileURLToPath(new URL(".", import.meta.url))
    const purpleCtaViolations = collectUiSourceFiles(sourceDirectory).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) => {
          const explicitPurpleCta =
            file.endsWith(".astro") &&
            (line.includes("bg-primary") || line.includes("bg-[var(--primary)]"))
          return explicitPurpleCta && !line.includes("rounded-full")
            ? [`${path.relative(sourceDirectory, file)}:${index + 1}`]
            : []
        }),
    )

    expect(buttonSource).toContain("rounded-full")
    expect(cardSource).toContain("rounded-lg")
    expect(heroSource).toContain("rounded-xl bg-muted")
    expect(commandCopySource).toContain("rounded-sm border border-border bg-background")
    expect(textareaSource).toContain("rounded-sm border border-input")
    expect(purpleCtaViolations).toEqual([])
  })

  it("should keep shared entities stable and give each localized home page its own WebPage", () => {
    expect(homePageSource).toContain('inLanguage: ["en", "fr"]')
    expect(homePageSource).toContain("url: siteUrl")
    expect(homePageSource).toContain('"@type": "WebPage"')
    expect(homePageSource).toMatch(localizedWebPageId)
    expect(homePageSource).toContain('about: { "@id": "https://ragmir.com/#source" }')
    expect(teamPageSource).toContain('url: "https://github.com/jb-thery"')
  })

  it("should expose AGPL and commercial licensing consistently", () => {
    expect(en.closing_open_source).toBe("AGPL-3.0 open source")
    expect(fr.closing_open_source).toBe("Open source AGPL-3.0")
    expect(en.footer_link_commercial_license).toBe("Commercial license")
    expect(fr.footer_link_commercial_license).toBe("Licence commerciale")
    expect(closingCtaSource).toContain('t("closing_open_source")')
    expect(footerSource).toContain("COMMERCIAL-LICENSE.md")
    expect(homePageSource).toContain(
      'license: "https://github.com/jcode-works/jcode-ragmir/blob/main/LICENSE"',
    )
    expect(homePageSource).toContain("usageInfo:")
    expect(homePageSource).toContain("COMMERCIAL-LICENSE.md")
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

  it("should keep hero terminal stories aligned with the current CLI and MCP contracts", () => {
    const shellCommands = HERO_DEMO_SCENARIOS.flatMap((scenario) =>
      scenario.lines.flatMap((line) => (line.kind === "shell" && line.text ? [line.text] : [])),
    )
    const setupCommands = shellCommands.filter((command) => command.startsWith("npx rgr setup"))
    const mcpKeys = HERO_DEMO_SCENARIOS.flatMap((scenario) =>
      scenario.lines.flatMap((line) =>
        line.kind === "mcp" && "textKey" in line ? [line.textKey] : [],
      ),
    )

    expect(shellCommands.some((command) => command === "npx rgr ingest")).toBe(true)
    expect(shellCommands).not.toContain("npx rgr doctor --fix")
    expect(setupCommands.every((command) => command.includes("--no-ingest"))).toBe(true)
    expect(coreCliSource).toContain('.command("setup")')
    expect(coreCliSource).toContain('.command("sources")')
    expect(coreCliSource).toContain('.command("ingest")')
    expect(coreCliSource).toContain('.command("bases")')
    expect(coreCliSource).toContain('.option("--no-ingest"')
    expect(coreCliSource).toContain('.option("--no-code"')
    expect(coreCliSource).toContain('.option("--compact"')
    expect(coreMcpSource).toContain('"ragmir_search"')
    expect(coreMcpSource).toContain("topK: z.number()")
    expect(coreMcpSource).toContain("compact: z.boolean().optional()")
    expect(
      mcpKeys.every((key) =>
        [en[key as keyof typeof en], fr[key as keyof typeof fr]].every(
          (value) =>
            typeof value === "string" &&
            value.includes("ragmir_search") &&
            value.includes("topK") &&
            value.includes("compact: true"),
        ),
      ),
    ).toBe(true)
    expect(en.demo_youtube_script_research).toContain("--no-code --compact --json")
    expect(fr.demo_visa_script_research).toContain("--no-code --compact --json")
    expect(
      Math.max(...HERO_DEMO_SCENARIOS.map((scenario) => scenario.lines.length)),
    ).toBeLessThanOrEqual(14)
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
    expect(en.faq_team_answer).toContain("metadata-only team comparison")
    expect(fr.faq_team_answer).toContain("comparaison d'équipe sans contenu source")
    for (const answer of [en.faq_team_answer, fr.faq_team_answer]) {
      expect(answer).toContain("Git")
      expect(answer).toContain("Ragmir")
      expect(answer.length).toBeLessThan(500)
    }
  })

  it("should keep visible FAQs and localized FAQ structured data on one content source", () => {
    expect(getFaqItems(en)).toHaveLength(10)
    expect(getFaqItems(fr)).toHaveLength(10)
    expect(homePageSource).toContain('"@type": "FAQPage"')
    expect(homePageSource).toContain("mainEntity: faqItems.map")
    expect(homePageSource).toContain('"@type": "Question"')
    expect(homePageSource).toContain('"@type": "Answer"')
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

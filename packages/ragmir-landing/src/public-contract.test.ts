import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import en from "../messages/en.json"
import fr from "../messages/fr.json"
import { findHeroDemoScenario, HERO_DEMO_SCENARIOS } from "./components/hero-demo-script.js"
import { USE_CASES } from "./components/use-case-carousel.js"
import { getFaqItems } from "./content/faq.js"
import { RAGMIR_SETUP_PROMPT } from "./content/setup-prompt.js"
import { getLocalizedUrl, loadTranslations, useTranslations } from "./i18n/utils.js"
import { cn } from "./lib/utils.js"

const homePageSource = readFileSync(
  fileURLToPath(new URL("./pages/[...locale]/index.astro", import.meta.url)),
  "utf8",
)
const layoutSource = readFileSync(
  fileURLToPath(new URL("./layouts/layout.astro", import.meta.url)),
  "utf8",
)
const astroConfigSource = readFileSync(
  fileURLToPath(new URL("../astro.config.mjs", import.meta.url)),
  "utf8",
)
const llmsSource = readFileSync(
  fileURLToPath(new URL("../public/llms.txt", import.meta.url)),
  "utf8",
)
const aiSource = readFileSync(fileURLToPath(new URL("../public/ai.txt", import.meta.url)), "utf8")
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
const agentsSource = readFileSync(
  fileURLToPath(new URL("./components/sections/agents.astro", import.meta.url)),
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
const rootReadmeSource = readFileSync(
  fileURLToPath(new URL("../../../README.md", import.meta.url)),
  "utf8",
)
const coreReadmeSource = readFileSync(
  fileURLToPath(new URL("../../ragmir-core/README.md", import.meta.url)),
  "utf8",
)
const agentIntegrationSource = readFileSync(
  fileURLToPath(new URL("../../../docs/agent-integration.md", import.meta.url)),
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
    expect(en.hero_title).toBe("Agentic RAG. For developers. With your sources.")
    expect(fr.hero_title).toBe("RAG agentique. Pour développeurs. Avec vos sources.")
    expect([en.hero_title_line_1, en.hero_title_line_2, en.hero_title_line_3]).toEqual([
      "Agentic RAG.",
      "For developers.",
      "With your sources.",
    ])
    expect([fr.hero_title_line_1, fr.hero_title_line_2, fr.hero_title_line_3]).toEqual([
      "RAG agentique.",
      "Pour développeurs.",
      "Avec vos sources.",
    ])
    expect(en.hero_description).toContain("Ragmir indexes locally")
    expect(fr.hero_description).toContain("Ragmir indexe en local")
    expect(heroSource).toContain('aria-label={t("hero_title")}')
    expect(heroSource).toContain("hero-title-outline")
    expect(heroSource).toContain("heroTitleLines.map")
    expect(heroSource).toContain('{t("hero_description")}')
    expect(heroSource).not.toContain("hero_subtagline")
  })

  it("should position Ragmir as the evidence layer for agentic RAG workflows", () => {
    expect(en.seo_home_title).toContain("Agentic RAG for developers")
    expect(fr.seo_home_title).toContain("RAG agentique pour développeurs")
    expect(en.seo_home_description).toContain("exact citations")
    expect(fr.seo_home_description).toContain("citations précises")
    for (const source of [llmsSource, aiSource]) {
      expect(source).toContain("retrieval and evidence layer for agentic RAG workflows")
      expect(source).toContain("The agent decides when to search")
      expect(source).toContain("It owns reasoning, generation, and actions")
    }
    expect(en.hero_metric_mcp_value).toBe("Library + CLI + MCP")
    expect(fr.hero_metric_mcp_value).toBe("Bibliothèque + CLI + MCP")
    expect(en.seo_home_keywords).not.toContain("local RAG API")
    expect(fr.seo_home_keywords).not.toContain("API RAG locale")
  })

  it("should distinguish local, self-hosted, and provider modes before the feature map", () => {
    expect(homePageSource.indexOf("<Agents translations={translations} />")).toBeLessThan(
      homePageSource.indexOf("<Features translations={translations} />"),
    )
    expect(en.agents_targets_title).toBe("Choose your operating mode")
    expect(fr.agents_targets_title).toBe("Choisissez votre mode de fonctionnement")
    expect(agentsSource).toContain('t("agents_full_local_name")')
    expect(agentsSource).toContain('t("agents_self_hosted_name")')
    expect(agentsSource).toContain('t("agents_connected_name")')
  })

  it("should present the bounded agent setup prompt before manual package-manager tabs", () => {
    expect(RAGMIR_SETUP_PROMPT.length).toBeLessThanOrEqual(4_000)
    expect(RAGMIR_SETUP_PROMPT).toContain("Prefer the declared manager, then the lockfile")
    expect(RAGMIR_SETUP_PROMPT).toContain("local-hash")
    expect(RAGMIR_SETUP_PROMPT).toContain("OCR")
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

  it("should use generic hreflang values while keeping regional Open Graph locales", () => {
    expect(layoutSource).toContain(
      'const hreflangLocaleMap: Record<string, string> = {\n  en: "en",\n  fr: "fr",',
    )
    expect(astroConfigSource).toContain(
      'locales: {\n                en: "en",\n                fr: "fr",',
    )
    expect(layoutSource).toContain('en: "en_US"')
    expect(layoutSource).toContain('fr: "fr_FR"')
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

  it("should distinguish three agentic workflows from one confidential chat workflow", () => {
    const agenticScenarioIds = ["feature", "incident", "migration"]

    expect(HERO_DEMO_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      ...agenticScenarioIds,
      "local",
    ])
    expect(USE_CASES.map((useCase) => useCase.id)).toEqual([...agenticScenarioIds, "local"])
    for (const scenarioId of agenticScenarioIds) {
      const scenario = findHeroDemoScenario(scenarioId)
      expect(scenario.terminalTitle).toContain("Claude Code / Codex")
      expect(scenario.lines.some((line) => line.kind === "codex")).toBe(true)
    }
    expect(findHeroDemoScenario("local").lines.some((line) => line.kind === "codex")).toBe(false)
    expect(en.demo_chat_model_options).toContain("self-hosted")
    expect(fr.demo_chat_model_options).toContain("auto-hébergé")
    expect(coreCliSource).toContain('.command("ocr")')
    expect(agentsSource).toContain("docs/agent-integration.md")
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
    expect(coreCliSource).toContain('.option("--compact"')
    expect(coreMcpSource).toContain('"ragmir_search"')
    expect(coreMcpSource).toContain("topK: z.number()")
    expect(coreMcpSource).toContain("compact: z.boolean().optional()")
    expect(coreMcpSource).toContain("const DEFAULT_MCP_TOP_K = 3")
    expect(coreMcpSource).toContain("compact !== false")
    expect(
      mcpKeys.every((key) =>
        [en[key as keyof typeof en], fr[key as keyof typeof fr]].every(
          (value) =>
            typeof value === "string" &&
            value.includes("ragmir_search") &&
            !value.includes("topK") &&
            !value.includes("compact"),
        ),
      ),
    ).toBe(true)
    expect(en.agents_text).toContain("three compact citations by default")
    expect(fr.agents_text).toContain("trois citations compactes par défaut")
    expect(
      Math.max(...HERO_DEMO_SCENARIOS.map((scenario) => scenario.lines.length)),
    ).toBeLessThanOrEqual(14)
  })

  it("should keep four workflows in public documentation and retired surfaces out of the landing", () => {
    for (const source of [rootReadmeSource, coreReadmeSource]) {
      expect(source).toContain("## Four workflow examples")
    }
    expect(agentIntegrationSource).toContain("## Four workflows")

    const liveLandingSources = [
      homePageSource,
      heroSource,
      llmsSource,
      aiSource,
      JSON.stringify(en),
      JSON.stringify(fr),
    ]
    for (const source of liveLandingSources) {
      expect(source).not.toMatch(
        /\b(?:Ragmir Chat|rgr chat|Ragmir TTS|rgr audio|rgr ask|rgr research|team sync|privacy profiles)\b/iu,
      )
    }
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

  it("should keep collaboration in the source-sharing workflow", () => {
    for (const answer of [en.faq_team_answer, fr.faq_team_answer]) {
      expect(answer).toContain("Git")
      expect(answer).toContain("rgr ingest")
      expect(answer.length).toBeLessThan(500)
    }
    for (const answer of [en.faq_offline_answer, fr.faq_offline_answer]) {
      expect(answer).toContain("local-hash")
      expect(answer).toContain("Transformers")
      expect(answer).toContain("Ollama")
    }
  })

  it("should keep visible localized FAQs without FAQPage structured data", () => {
    expect(getFaqItems(en)).toHaveLength(10)
    expect(getFaqItems(fr)).toHaveLength(10)
    expect(homePageSource).toContain("<Faq translations={translations} />")
    expect(homePageSource).not.toContain('"@type": "FAQPage"')
    expect(homePageSource).not.toContain("mainEntity: faqItems.map")
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

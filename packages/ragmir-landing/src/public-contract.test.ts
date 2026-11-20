import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import en from "../messages/en.json"
import es from "../messages/es.json"
import fr from "../messages/fr.json"
import zh from "../messages/zh.json"
import { findHeroDemoScenario, HERO_DEMO_SCENARIOS } from "./components/hero-demo-script.js"
import { USE_CASES } from "./components/use-case-carousel.js"
import { getFaqItems } from "./content/faq.js"
import { RAGMIR_SETUP_PROMPT } from "./content/setup-prompt.js"
import { FEATURED_FORMATS, SUPPORTED_FORMAT_GROUPS } from "./content/supported-formats.js"
import {
  getLocalizedUrl,
  languageTag,
  loadTranslations,
  locales,
  useTranslations,
} from "./i18n/utils.js"
import {
  HERO_DEMO_TRANSLATIONS,
  LIBRARY_TRANSLATIONS,
  NAVBAR_TRANSLATIONS,
  pickTranslations,
  type TranslationSelection,
  USE_CASE_TRANSLATIONS,
} from "./lib/island-translations.js"
import { FOOTER_LINK_KEYS, PROJECT_LINK_LABEL_KEYS, PROJECT_LINKS } from "./lib/project-links.js"
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
const heroDemoSource = readFileSync(
  fileURLToPath(new URL("./components/hero-demo.tsx", import.meta.url)),
  "utf8",
)
const useCaseSource = readFileSync(
  fileURLToPath(new URL("./components/use-case-carousel.tsx", import.meta.url)),
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
const deploySource = readFileSync(
  fileURLToPath(new URL("./components/sections/deploy.astro", import.meta.url)),
  "utf8",
)
const navbarSource = readFileSync(
  fileURLToPath(new URL("./components/landing-navbar.tsx", import.meta.url)),
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
const coreLangchainSource = readFileSync(
  fileURLToPath(new URL("../../ragmir-core/src/langchain.ts", import.meta.url)),
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
  it("should keep every locale's translation keys in parity with English, in the same order", () => {
    for (const messages of [fr, es, zh]) {
      expect(Object.keys(messages)).toEqual(Object.keys(en))
      expect(Object.entries(messages).filter(([, value]) => value.trim() === "")).toEqual([])
    }
  })

  it("should keep a prominent outlined headline on three localized lines", () => {
    expect(en.hero_title).toBe("Agentic RAG. Your infrastructure. Exact citations.")
    expect(fr.hero_title).toBe("RAG agentique. Votre infrastructure. Citations exactes.")
    expect([en.hero_title_line_1, en.hero_title_line_2, en.hero_title_line_3]).toEqual([
      "Agentic RAG.",
      "Your infrastructure.",
      "Exact citations.",
    ])
    expect([fr.hero_title_line_1, fr.hero_title_line_2, fr.hero_title_line_3]).toEqual([
      "RAG agentique.",
      "Votre infrastructure.",
      "Citations exactes.",
    ])
    expect(en.hero_description).toContain("Ragmir indexes locally")
    expect(fr.hero_description).toContain("Ragmir indexe en local")
    expect(heroSource).toContain('aria-label={t("hero_title")}')
    expect(heroSource).toContain("hero-title-outline")
    expect(heroSource).toContain("heroTitleLines.map")
    expect(heroSource).toContain('{t("hero_description")}')
    expect(heroSource).not.toContain("hero_subtagline")
  })

  it("should back the hero with the measured benchmark numbers of the README", () => {
    expect([en.hero_proof_recall_value, en.hero_proof_speed_value]).toEqual(["94%", "36 ms"])
    expect([fr.hero_proof_recall_value, fr.hero_proof_speed_value]).toEqual(["94 %", "36 ms"])
    expect(en.hero_proof_speed_label).toContain("30,171-chunk monorepo")
    expect(heroSource).toContain('t("hero_proof_recall_value")')
    expect(PROJECT_LINKS.benchmarks).toBe("https://github.com/jcode-works/ragmir#benchmarks")
    expect(heroSource).toContain("PROJECT_LINKS.benchmarks")
  })

  it("should send visitors to GitHub, npm, and PyPI from the navbar and the footer", () => {
    expect(PROJECT_LINKS.github).toBe("https://github.com/jcode-works/ragmir")
    expect(PROJECT_LINKS.npm).toBe("https://www.npmjs.com/package/@jcode.labs/ragmir")
    expect(PROJECT_LINKS.pypi).toBe("https://pypi.org/project/ragmir/")
    for (const source of [navbarSource, footerSource]) {
      expect(source).toContain('t("hero_github_cta")')
      expect(source).toContain('t("hero_npm_cta")')
      expect(source).toContain('t("hero_pypi_cta")')
    }
    expect([en.hero_github_cta, en.hero_npm_cta, en.hero_pypi_cta]).toEqual([
      "View on GitHub",
      "View on npm",
      "View on PyPI",
    ])
    expect([fr.hero_github_cta, fr.hero_npm_cta, fr.hero_pypi_cta]).toEqual([
      "Voir sur GitHub",
      "Voir sur npm",
      "Voir sur PyPI",
    ])
  })

  it("should list every project link in the footer and label it in both locales", () => {
    expect([...FOOTER_LINK_KEYS].sort()).toEqual(Object.keys(PROJECT_LINKS).sort())
    expect(footerSource).toContain("FOOTER_SECTIONS.map")
    expect(navbarSource).toContain("PROJECT_LINKS[key]")
    for (const key of Object.values(PROJECT_LINK_LABEL_KEYS)) {
      expect(en).toHaveProperty(key)
      expect(fr).toHaveProperty(key)
    }
    for (const key of [
      "nav_faq",
      "nav_integrations",
      "nav_section_docs",
      "nav_section_project",
      "footer_section_product",
      "footer_section_integrations",
    ]) {
      expect(en).toHaveProperty(key)
      expect(fr).toHaveProperty(key)
    }
  })

  it("should position Ragmir as the evidence layer for agentic RAG workflows", () => {
    expect(en.seo_home_title).toContain("Self-hosted agentic RAG")
    expect(fr.seo_home_title).toContain("RAG agentique auto-hébergé")
    expect(en.seo_home_title.length).toBeLessThanOrEqual(60)
    expect(en.seo_home_description.length).toBeLessThanOrEqual(160)
    expect(en.seo_home_description).toContain("exact citations")
    expect(fr.seo_home_description).toContain("citations précises")
    for (const source of [llmsSource, aiSource]) {
      expect(source).toContain("retrieval and evidence layer for agentic RAG workflows")
      expect(source).toContain("The agent decides when to search")
      expect(source).toContain("It owns reasoning, generation, and actions")
    }
    expect(en.seo_home_keywords).not.toContain("local RAG API")
    expect(fr.seo_home_keywords).not.toContain("API RAG locale")
  })

  it("should number the sections in page order and alternate the dot field from the hero", () => {
    const sections = [
      ["UseCases", "sections/use-cases.astro"],
      ["Capabilities", "sections/capabilities.astro"],
      ["Comparison", "sections/comparison.astro"],
      ["LibrarySection", "library-section.tsx"],
      ["Integrations", "sections/integrations.astro"],
      ["Agents", "sections/agents.astro"],
      ["Deploy", "sections/deploy.astro"],
      ["Privacy", "sections/privacy.astro"],
      ["Faq", "sections/faq.astro"],
    ] as const
    const positions = sections.map(([tag]) => homePageSource.indexOf(`<${tag}`))
    expect(positions.every((position, index) => position > (positions[index - 1] ?? 0))).toBe(true)
    sections.forEach(([, file], index) => {
      const source = readFileSync(
        fileURLToPath(new URL(`./components/${file}`, import.meta.url)),
        "utf8",
      )
      expect(source).toContain(`num="${String(index + 1).padStart(3, "0")}"`)
    })
    // The hero draws the field itself; after it, every second band does.
    expect(heroSource).toContain("RagmirBackground")
    expect(
      [...homePageSource.matchAll(/<AnimatedBackdrop>\s*<(\w+)/gu)].map((match) => match[1]),
    ).toEqual(["Capabilities", "LibrarySection", "Agents", "Privacy", "ClosingCta"])
    expect(homePageSource).not.toContain("<RagmirBackground")
    expect(footerSource).not.toContain("RagmirBackground")
  })

  it("should say what Ragmir adds to a coding agent's own search, and where it does not", () => {
    const comparisonSource = readFileSync(
      fileURLToPath(new URL("./components/sections/comparison.astro", import.meta.url)),
      "utf8",
    )
    expect(comparisonSource).toContain('id="comparison"')
    for (const row of ["formats", "wording", "corpus", "silence", "data", "quality"]) {
      expect(comparisonSource).toContain(`"${row}"`)
      for (const part of ["name", "alone", "ragmir"]) {
        expect(en).toHaveProperty(`comparison_${row}_${part}`)
        expect(fr).toHaveProperty(`comparison_${row}_${part}`)
      }
    }
    // A no-break space keeps "Claude Code" on one line in the title.
    expect(en.comparison_title.replaceAll("\u00a0", " ")).toContain("Claude Code or Codex")
    expect(fr.comparison_title.replaceAll("\u00a0", " ")).toContain("Claude Code ou Codex")
    // The limits stay next to the claims: grep remains the tool for every occurrence or a regex.
    expect(en.comparison_enough_text).toContain("grep")
    expect(fr.comparison_enough_text).toContain("grep")
    for (const messages of [en, fr, es, zh]) {
      expect(Object.values(messages).filter((text) => text.includes("—"))).toEqual([])
    }
  })

  it("should present every capability group with its four items", () => {
    const capabilitiesSource = readFileSync(
      fileURLToPath(new URL("./components/sections/capabilities.astro", import.meta.url)),
      "utf8",
    )
    expect(capabilitiesSource).toContain('id="capabilities"')
    // Featured formats first; every family stays one click away in a native disclosure.
    expect(capabilitiesSource).toContain("SUPPORTED_FORMAT_GROUPS.map")
    expect(capabilitiesSource).toContain("<details")
    const listedFormats = new Set<string>(SUPPORTED_FORMAT_GROUPS.flatMap((group) => group.formats))
    expect(FEATURED_FORMATS.filter((format) => !listedFormats.has(format))).toEqual([])
    for (const group of [
      "index",
      "search",
      "cite",
      "wiki",
      "connect",
      "measure",
      "run",
      "control",
    ]) {
      expect(capabilitiesSource).toContain(`"${group}"`)
      for (const item of [1, 2, 3, 4]) {
        for (const part of ["name", "text"]) {
          expect(en).toHaveProperty(`capabilities_${group}_${item}_${part}`)
          expect(fr).toHaveProperty(`capabilities_${group}_${item}_${part}`)
        }
      }
    }
    expect(homePageSource).toContain("#capabilities")
    expect(teamPageSource).toContain("#capabilities")
  })

  it("should distinguish local, self-hosted, and provider modes", () => {
    expect(en.agents_targets_title).toBe("Choose your operating mode")
    expect(fr.agents_targets_title).toBe("Choisissez votre mode de fonctionnement")
    expect(agentsSource).toContain('t("agents_full_local_name")')
    expect(agentsSource).toContain('t("agents_self_hosted_name")')
    expect(agentsSource).toContain('t("agents_connected_name")')
  })

  it("should show teams shipping RAG how to deploy on their own servers", () => {
    expect(homePageSource.indexOf("<Agents translations={translations} />")).toBeLessThan(
      homePageSource.indexOf("<Deploy translations={translations} />"),
    )
    expect(homePageSource.indexOf("<Deploy translations={translations} />")).toBeLessThan(
      homePageSource.indexOf("<Privacy translations={translations} />"),
    )
    expect(deploySource).toContain('id="deploy"')
    expect(deploySource).toContain("PROJECT_LINKS.serverGuide")
    expect(PROJECT_LINKS.serverGuide).toBe(
      "https://github.com/jcode-works/ragmir/blob/main/docs/server-deployment.md",
    )
    expect(navbarSource).toContain('t("nav_deploy")')
    expect(en.deploy_text).toContain("Forward deployed engineers")
    expect(fr.deploy_text).toContain("forward deployed engineers")
    for (const source of [rootReadmeSource, coreReadmeSource, llmsSource, aiSource]) {
      expect(source).toContain("docs/server-deployment.md")
    }
    for (const source of [rootReadmeSource, coreReadmeSource, llmsSource, aiSource]) {
      expect(source).toContain("docs/python.md")
    }
    expect(PROJECT_LINKS.pythonGuide).toBe(
      "https://github.com/jcode-works/ragmir/blob/main/docs/python.md",
    )
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
    expect(librarySource).toContain('className="h-[5.5rem] min-h-[5.5rem]')
    expect(librarySource).toContain("rounded-xl border-0 bg-background")
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
    // Borderless grey cards; nested surfaces share the darker inset and the card radius.
    expect(cardSource).toContain("rounded-xl bg-card")
    expect(cardSource).not.toContain("border")
    expect(commandCopySource).toContain("rounded-xl bg-background")
    expect(useCaseSource).toContain("rounded-xl bg-card")
    expect(useCaseSource).toContain("rounded-xl bg-background")
    expect(textareaSource).toContain("rounded-sm border border-input")
    expect(purpleCtaViolations).toEqual([])
  })

  it("should keep shared entities stable and give each localized home page its own WebPage", () => {
    // Shared entities list every locale by its BCP 47 tag; each page names its own language.
    expect(homePageSource).toContain("inLanguage: locales.map(languageTag)")
    expect(homePageSource).toContain("inLanguage: languageTag(locale)")
    expect(locales.map(languageTag)).toEqual(["en", "fr", "es", "zh-Hans"])
    expect(homePageSource).toContain("url: siteUrl")
    expect(homePageSource).toContain('"@type": "WebPage"')
    expect(homePageSource).toMatch(localizedWebPageId)
    expect(homePageSource).toContain('about: { "@id": "https://ragmir.com/#source" }')
    expect(teamPageSource).toContain('url: "https://github.com/jb-thery"')
  })

  it("should use generic hreflang values while keeping regional Open Graph locales", () => {
    // Chinese pages are Simplified Chinese: a script subtag, still no region.
    expect(layoutSource).toContain(
      'const hreflangLocaleMap: Record<string, string> = {\n  en: "en",\n  fr: "fr",\n  es: "es",\n  zh: "zh-Hans",',
    )
    expect(astroConfigSource).toContain(
      'locales: {\n                en: "en",\n                fr: "fr",\n                es: "es",\n                zh: "zh-Hans",',
    )
    expect(layoutSource).toContain('en: "en_US"')
    expect(layoutSource).toContain('fr: "fr_FR"')
    expect(layoutSource).toContain('es: "es_ES"')
    expect(layoutSource).toContain('zh: "zh_CN"')
    // Alternates strip whichever locale prefix the page has, not only /fr.
    expect(layoutSource).toContain("getLocalizedUrl(basePath, targetLocale)")
  })

  it("should expose AGPL and commercial licensing consistently", () => {
    expect(en.closing_open_source).toBe("AGPL-3.0 open source")
    expect(fr.closing_open_source).toBe("Open source AGPL-3.0")
    expect(en.footer_link_commercial_license).toBe("Commercial license")
    expect(fr.footer_link_commercial_license).toBe("Licence commerciale")
    expect(closingCtaSource).toContain('t("closing_open_source")')
    expect(PROJECT_LINKS.commercialLicense).toContain("COMMERCIAL-LICENSE.md")
    expect(PROJECT_LINKS.license).toBe("https://github.com/jcode-works/ragmir/blob/main/LICENSE")
    expect(FOOTER_LINK_KEYS).toContain("commercialLicense")
    expect(FOOTER_LINK_KEYS).toContain("license")
    expect(homePageSource).toContain("license: PROJECT_LINKS.license")
    expect(homePageSource).toContain("usageInfo: PROJECT_LINKS.commercialLicense")
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

  it("should pair two coding-agent workflows with an AI product and a confidential chat", () => {
    const agenticScenarioIds = ["feature", "incident"]
    const workflowIds = [...agenticScenarioIds, "product", "local"]

    // The hero adds a customer deployment, a scans story, and three personal corpora (a YouTube
    // script, paperwork, a job search) to the four use cases.
    expect(HERO_DEMO_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      ...agenticScenarioIds,
      "product",
      "deploy",
      "scans",
      "local",
      "youtube",
      "paperwork",
      "jobs",
    ])
    expect(USE_CASES.map((useCase) => useCase.id)).toEqual(workflowIds)
    for (const scenarioId of agenticScenarioIds) {
      const scenario = findHeroDemoScenario(scenarioId)
      expect(scenario.terminalTitle).toContain("Claude Code / Codex")
      expect(scenario.lines.some((line) => line.kind === "codex")).toBe(true)
    }
    const product = findHeroDemoScenario("product")
    expect(product.lines.some((line) => line.kind === "codex")).toBe(false)
    expect(product.lines.some((line) => line.text?.includes("retriever.invoke("))).toBe(true)
    expect(coreLangchainSource).toContain("class RagmirRetriever")
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
    expect(coreMcpSource).toMatch(/topK: z\s*\.number\(\)/u)
    expect(coreMcpSource).toMatch(/compact: z\s*\.boolean\(\)\s*\.optional\(\)/u)
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

  it("should pass each React island the translations it reads and nothing more", () => {
    const keysReadBy = (source: string): string[] =>
      Array.from(source.matchAll(/\bt\("([a-z0-9_]+)"\)/gu), (match) => match[1] ?? "")
    const heroScenarioKeys = HERO_DEMO_SCENARIOS.flatMap((scenario) => [
      scenario.titleKey,
      scenario.descriptionKey,
      scenario.badgeKey,
      ...scenario.lines.flatMap((line) => (line.textKey ? [line.textKey] : [])),
    ])
    const useCaseKeys = USE_CASES.flatMap((useCase) => [
      useCase.tabKey,
      useCase.titleKey,
      useCase.descriptionKey,
      ...useCase.steps.flatMap((step) => [step.labelKey, step.titleKey]),
    ])
    const islands: [TranslationSelection, string[]][] = [
      [
        NAVBAR_TRANSLATIONS,
        [...keysReadBy(navbarSource), ...Object.values(PROJECT_LINK_LABEL_KEYS)],
      ],
      [HERO_DEMO_TRANSLATIONS, [...keysReadBy(heroDemoSource), ...heroScenarioKeys]],
      [USE_CASE_TRANSLATIONS, [...keysReadBy(useCaseSource), ...useCaseKeys]],
      [LIBRARY_TRANSLATIONS, keysReadBy(librarySource)],
    ]

    for (const [selection, keys] of islands) {
      for (const dictionary of [en, fr]) {
        const picked = pickTranslations(dictionary, selection)
        expect(keys.filter((key) => !(key in picked))).toEqual([])
        expect(Object.keys(picked).length).toBeLessThan(Object.keys(dictionary).length / 3)
      }
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

  it("should present the cited wiki with the commands that keep it honest", () => {
    for (const answer of [en.faq_wiki_answer, fr.faq_wiki_answer]) {
      for (const command of [
        "rgr audit --knowledge",
        "ragmir_expand",
        "changedSince",
        "npx skills add jcode-works/ragmir",
      ]) {
        expect(answer).toContain(command)
      }
    }
    expect(en.agents_text).toContain("up to five phrasings")
    expect(fr.agents_text).toContain("jusqu’à cinq formulations")
  })

  it("should keep visible localized FAQs without FAQPage structured data", () => {
    for (const messages of [en, fr, es, zh]) {
      expect(getFaqItems(messages)).toHaveLength(16)
    }
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

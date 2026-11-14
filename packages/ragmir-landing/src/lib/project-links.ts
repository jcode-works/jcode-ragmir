// Public project destinations. The hero, the mobile drawer, and the footer read this one list, so
// a link added or moved here reaches every surface at once.
export const GITHUB_URL = "https://github.com/jcode-works/jcode-ragmir"
export const NPM_URL = "https://www.npmjs.com/package/@jcode.labs/ragmir"

export const PROJECT_LINKS = {
  github: GITHUB_URL,
  npm: NPM_URL,
  docs: `${GITHUB_URL}/wiki`,
  apiReference: `${GITHUB_URL}/blob/main/docs/api-reference.md`,
  serverGuide: `${GITHUB_URL}/blob/main/docs/server-deployment.md`,
  pythonGuide: `${GITHUB_URL}/blob/main/docs/python.md`,
  benchmarks: `${GITHUB_URL}#benchmarks`,
  releases: `${GITHUB_URL}/releases/latest`,
  changelog: `${GITHUB_URL}/blob/main/CHANGELOG.md`,
  license: `${GITHUB_URL}/blob/main/LICENSE`,
  commercialLicense: `${GITHUB_URL}/blob/main/COMMERCIAL-LICENSE.md`,
  privacy: `${GITHUB_URL}/blob/main/PRIVACY.md`,
  security: `${GITHUB_URL}/blob/main/SECURITY.md`,
  claudePlugin: `${GITHUB_URL}/tree/main/plugins/ragmir`,
  agentPlugins: `${GITHUB_URL}/blob/main/docs/agent-integration.md#plugins-and-extensions-for-coding-agents`,
  langchainRetriever: `${GITHUB_URL}/blob/main/docs/api-reference.md#langchainjs-retriever`,
  mcpGuide: `${GITHUB_URL}/blob/main/docs/agent-integration.md#connect-an-agent-through-mcp`,
} as const

export type ProjectLinkKey = keyof typeof PROJECT_LINKS

/** Translation key of each project link label, shared by the drawer and the footer. */
export const PROJECT_LINK_LABEL_KEYS: Record<ProjectLinkKey, string> = {
  github: "nav_github",
  npm: "footer_link_npm",
  docs: "footer_link_docs",
  apiReference: "footer_link_api",
  serverGuide: "footer_link_server_guide",
  pythonGuide: "footer_link_python_guide",
  benchmarks: "footer_link_benchmarks",
  releases: "footer_link_releases",
  changelog: "footer_link_changelog",
  license: "footer_link_license",
  commercialLicense: "footer_link_commercial_license",
  privacy: "footer_link_privacy",
  security: "footer_link_security",
  claudePlugin: "footer_link_claude_plugin",
  agentPlugins: "footer_link_agent_plugins",
  langchainRetriever: "footer_link_langchain",
  mcpGuide: "footer_link_mcp",
}

/** One titled footer column: in-page anchors of the home page, then project destinations. */
export interface FooterSection {
  titleKey: string
  /** Home page anchors with the translation key of their label, such as `#integrations`. */
  anchors?: ReadonlyArray<{ hash: string; labelKey: string }>
  links: readonly ProjectLinkKey[]
}

/** The footer columns: the page itself, the integrations, the documentation, then the project. */
export const FOOTER_SECTIONS: readonly FooterSection[] = [
  {
    titleKey: "footer_section_product",
    anchors: [
      { hash: "library", labelKey: "nav_library" },
      { hash: "integrations", labelKey: "nav_integrations" },
      { hash: "use-cases", labelKey: "nav_use_cases" },
      { hash: "deploy", labelKey: "nav_deploy" },
      { hash: "features", labelKey: "nav_features" },
      { hash: "faq", labelKey: "nav_faq" },
    ],
    links: [],
  },
  {
    titleKey: "footer_section_integrations",
    links: ["claudePlugin", "agentPlugins", "langchainRetriever", "pythonGuide", "mcpGuide"],
  },
  {
    titleKey: "nav_section_docs",
    links: ["docs", "apiReference", "serverGuide", "benchmarks", "changelog", "releases"],
  },
  {
    titleKey: "nav_section_project",
    links: ["github", "npm", "license", "commercialLicense", "privacy", "security"],
  },
]

/** Every project destination the footer shows, in column order. */
export const FOOTER_LINK_KEYS: readonly ProjectLinkKey[] = FOOTER_SECTIONS.flatMap(
  (section) => section.links,
)

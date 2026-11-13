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
  benchmarks: `${GITHUB_URL}#benchmarks`,
  releases: `${GITHUB_URL}/releases/latest`,
  changelog: `${GITHUB_URL}/blob/main/CHANGELOG.md`,
  license: `${GITHUB_URL}/blob/main/LICENSE`,
  commercialLicense: `${GITHUB_URL}/blob/main/COMMERCIAL-LICENSE.md`,
} as const

export type ProjectLinkKey = keyof typeof PROJECT_LINKS

/** Translation key of each project link label, shared by the drawer and the footer. */
export const PROJECT_LINK_LABEL_KEYS: Record<ProjectLinkKey, string> = {
  github: "nav_github",
  npm: "footer_link_npm",
  docs: "footer_link_docs",
  apiReference: "footer_link_api",
  serverGuide: "footer_link_server_guide",
  benchmarks: "footer_link_benchmarks",
  releases: "footer_link_releases",
  changelog: "footer_link_changelog",
  license: "footer_link_license",
  commercialLicense: "footer_link_commercial_license",
}

/** The footer order: where the code lives first, then documentation, then licensing. */
export const FOOTER_LINK_KEYS: readonly ProjectLinkKey[] = [
  "github",
  "npm",
  "docs",
  "apiReference",
  "serverGuide",
  "benchmarks",
  "releases",
  "changelog",
  "license",
  "commercialLicense",
]

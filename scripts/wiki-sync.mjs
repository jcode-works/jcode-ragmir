// Copies the docs/ guides into a checkout of the GitHub wiki (jcode-ragmir.wiki.git).
// Usage: pnpm wiki:sync <wiki checkout>, then review `git diff` there, update Home.md by hand,
// commit, and push. Links to a guide that has a wiki page stay in the wiki; other relative links
// point to main on GitHub.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const REPOSITORY = "https://github.com/jcode-works/jcode-ragmir"
const GUIDE_PAGES = {
  "agent-integration.md": "Agent-Integration",
  "api-reference.md": "TypeScript-API",
  "cli-reference.md": "CLI-Reference",
  "configuration.md": "Configuration",
  "docker.md": "Docker",
  "migration.md": "Migration",
  "python.md": "Python",
  "quick-start.md": "Getting-Started",
  "server-deployment.md": "Server-Deployment",
  "supported-formats.md": "Supported-Formats",
  "troubleshooting.md": "Troubleshooting",
}
const ROOT_PAGES = { "SECURITY-HARDENING.md": "Security-Hardening" }

const wikiDir = process.argv[2]
if (!wikiDir || !existsSync(path.join(wikiDir, "_Sidebar.md"))) {
  console.error("Usage: pnpm wiki:sync <checkout of jcode-ragmir.wiki.git>")
  process.exit(1)
}
const repoDir = path.resolve(import.meta.dirname, "..")

function repositoryLink(target) {
  const [file] = target.split("#")
  const kind = path.extname(file) === "" ? "tree" : "blob"
  return `${REPOSITORY}/${kind}/main/${target}`
}

function wikiLinks(text) {
  return text.replace(/\]\((\.\.?\/[^)\s]+)\)/g, (_match, target) => {
    const [file, anchor] = target.split("#")
    const suffix = anchor ? `#${anchor}` : ""
    if (file.startsWith("./")) {
      const guide = file.slice(2)
      const page = GUIDE_PAGES[guide]
      return `](${page ? `${page}${suffix}` : repositoryLink(`docs/${guide}${suffix}`)})`
    }
    const rootFile = file.slice(3)
    const page = ROOT_PAGES[rootFile]
    return `](${page ? `${page}${suffix}` : repositoryLink(`${rootFile}${suffix}`)})`
  })
}

for (const [guide, page] of Object.entries(GUIDE_PAGES)) {
  const source = readFileSync(path.join(repoDir, "docs", guide), "utf8")
  writeFileSync(path.join(wikiDir, `${page}.md`), wikiLinks(source))
}
const sidebar = readFileSync(path.join(wikiDir, "_Sidebar.md"), "utf8")
const missing = Object.values(GUIDE_PAGES).filter((page) => !sidebar.includes(page))
console.log(`Synced ${Object.keys(GUIDE_PAGES).length} wiki pages from docs/.`)
if (missing.length > 0) {
  console.log(`Add these pages to _Sidebar.md: ${missing.join(", ")}`)
}

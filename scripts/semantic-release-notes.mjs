const REPOSITORY_URL = "https://github.com/jcode-works/jcode-ragmir"
const SECTION_LABELS = {
  "Release highlights": "highlights",
  "Release details": "details",
  Verification: "verification",
}

export function verifyRelease(_pluginConfig, context) {
  curatedRelease(context.commits)
}

export function generateNotes(_pluginConfig, context) {
  const release = curatedRelease(context.commits)
  const version = context.nextRelease.version
  const previousTag = context.lastRelease?.gitTag
  const nextTag = context.nextRelease.gitTag ?? `v${version}`
  const notes = [
    "## Highlights",
    "",
    ...release.highlights,
    "",
    "## What changed",
    "",
    ...release.details,
    "",
    "## Verification",
    "",
    ...release.verification,
    "- Release assets include the Core tarball, checksums, an SBOM, and the release manifest",
    "- The protected npm workflow requires publication with provenance",
    "",
    "## Install or upgrade",
    "",
    "```bash",
    `npm install --save-dev @jcode.labs/ragmir@${version}`,
    "```",
    "",
    "Requires Node.js 22.12 or later. Semantic embeddings use the separately installed optional Transformers package.",
    "",
    `[Core on npm](https://www.npmjs.com/package/@jcode.labs/ragmir/v/${version}) · [Migration guide](${REPOSITORY_URL}/blob/${nextTag}/docs/migration.md)`,
    "",
  ]

  if (previousTag) {
    notes.push(
      "",
      `**Full changelog:** [\`${previousTag}...${nextTag}\`](${REPOSITORY_URL}/compare/${previousTag}...${nextTag})`,
    )
  }

  return notes.join("\n")
}

function curatedRelease(commits = []) {
  for (const commit of commits) {
    const sections = parseSections(commit?.message ?? "")
    if (sections !== null) return sections
  }

  throw new Error(
    "Release commits must contain Release highlights, Release details, and Verification sections with at least one bullet each.",
  )
}

function parseSections(message) {
  const sections = { highlights: [], details: [], verification: [] }
  let activeSection = null

  for (const line of message.split(/\r?\n/u)) {
    const label = line.match(/^(Release highlights|Release details|Verification):\s*$/u)?.[1]
    if (label) {
      activeSection = SECTION_LABELS[label]
      continue
    }
    if (!activeSection) continue
    if (/^-\s+\S/u.test(line)) {
      sections[activeSection].push(line.trim())
      continue
    }
    if (/^\s{2,}\S/u.test(line)) {
      const entries = sections[activeSection]
      const entryIndex = entries.length - 1
      if (entryIndex >= 0) entries[entryIndex] = `${entries[entryIndex]} ${line.trim()}`
    }
  }

  return Object.values(sections).every((entries) => entries.length > 0) ? sections : null
}

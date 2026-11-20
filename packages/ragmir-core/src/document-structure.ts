import YAML from "yaml"
import { isRecord } from "./guards.js"

export type StructuralSpanKind = "markdown-section" | "json-node" | "jsonl-entry"

export interface StructuralSpan {
  charStart: number
  charEnd: number
  contextPath: string
  kind: StructuralSpanKind
}

interface TextLine {
  start: number
  end: number
  contentEnd: number
  text: string
}

interface MarkdownHeading {
  start: number
  level: number
  title: string
}

interface JsonNode {
  start: number
  end: number
  path: string
  parentPath: string
  children: JsonNode[]
}

// Markdown and its dialects: Quarto, R Markdown, Markdoc, Livebook, Cursor rules, ronn manual
// pages, and mdsvex.
export const MARKDOWN_EXTENSIONS: ReadonlySet<string> = new Set([
  ".livemd",
  ".markdown",
  ".md",
  ".mdc",
  ".mdoc",
  ".mdown",
  ".mdtext",
  ".mdtxt",
  ".mdwn",
  ".mdx",
  ".mkd",
  ".mkdn",
  ".qmd",
  ".rmd",
  ".ronn",
  ".svx",
])
const ATX_HEADING_PATTERN = /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/u
const SETEXT_HEADING_PATTERN = /^ {0,3}(=+|-+)\s*$/u
const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/u
// Front matter is a short metadata block; a longer leading `---` pair is a thematic break.
const FRONTMATTER_MAX_CHARACTERS = 16_384
const FRONTMATTER_TITLE_MAX_CHARACTERS = 200
const FRONTMATTER_DESCRIPTION_MAX_CHARACTERS = 500
// Its first line is a key, which tells it apart from prose between two thematic breaks.
const YAML_KEY_LINE_PATTERN = /^["']?[\p{L}\p{N}_][^:\n]*:(?:\s|$)/u
const TOML_KEY_LINE_PATTERN = /^(?:\[[^\]\n]+\]|["']?[\p{L}\p{N}_][\w.-]*["']?\s*=)/u

/** A leading front matter block of a Markdown page, and the fields Ragmir reads from it. */
export interface MarkdownFrontmatter {
  /** Offset just past the closing fence line. */
  end: number
  title?: string
  description?: string
}

export function structuralSpans(
  text: string,
  extension: string,
  chunkSize: number,
): StructuralSpan[] {
  if (MARKDOWN_EXTENSIONS.has(extension)) {
    return markdownSectionSpans(text)
  }
  if (extension === ".json") {
    return jsonNodeSpans(text, chunkSize)
  }
  if (extension === ".jsonl" || extension === ".ndjson") {
    return jsonlEntrySpans(text, chunkSize)
  }
  return []
}

export function markdownFenceSpans(text: string): Array<{ start: number; end: number }> {
  const lines = textLines(text)
  const spans: Array<{ start: number; end: number }> = []
  let opening: { marker: string; start: number } | null = null

  for (const line of lines) {
    const match = FENCE_PATTERN.exec(line.text)
    if (!match?.[1]) {
      continue
    }
    const marker = match[1]
    if (!opening) {
      opening = { marker: marker[0] ?? "`", start: line.start }
      continue
    }
    if ((marker[0] ?? "") === opening.marker) {
      spans.push({ start: opening.start, end: line.end })
      opening = null
    }
  }

  if (opening) {
    spans.push({ start: opening.start, end: text.length })
  }
  return spans
}

/**
 * The YAML (`---`) or TOML (`+++`) block that opens a page of Obsidian, Astro, Docusaurus, Hugo,
 * Jekyll, or an LLM-maintained wiki. YAML is read as data, never executed, for `title` and
 * `description` (or `summary`); TOML is only delimited. Null when the page has none.
 */
export function markdownFrontmatter(text: string): MarkdownFrontmatter | null {
  const lines = textLines(text.slice(0, FRONTMATTER_MAX_CHARACTERS))
  const opening = lines[0]?.text.trimEnd()
  if (opening !== "---" && opening !== "+++") {
    return null
  }
  const yaml = opening === "---"
  const closingIndex = lines.findIndex(
    (line, index) =>
      index > 0 &&
      (yaml
        ? line.text.trimEnd() === "---" || line.text.trimEnd() === "..."
        : line.text.trimEnd() === "+++"),
  )
  const closing = lines[closingIndex]
  const firstKey = lines.slice(1, closingIndex).find((line) => line.text.trim() !== "")
  if (
    !closing ||
    !firstKey ||
    !(yaml ? YAML_KEY_LINE_PATTERN : TOML_KEY_LINE_PATTERN).test(firstKey.text.trim())
  ) {
    return null
  }
  const fields = yaml ? yamlFrontmatterFields(text.slice(lines[0]?.end ?? 0, closing.start)) : {}
  return { end: closing.end, ...fields }
}

function yamlFrontmatterFields(body: string): Pick<MarkdownFrontmatter, "title" | "description"> {
  let data: unknown
  try {
    data = YAML.parse(body)
  } catch {
    // A malformed block still delimits the front matter; it only yields no fields.
    return {}
  }
  if (!isRecord(data)) {
    return {}
  }
  const title = frontmatterText(data.title, FRONTMATTER_TITLE_MAX_CHARACTERS)
  const description = frontmatterText(
    data.description ?? data.summary,
    FRONTMATTER_DESCRIPTION_MAX_CHARACTERS,
  )
  return {
    ...(title === null ? {} : { title }),
    ...(description === null ? {} : { description }),
  }
}

function frontmatterText(value: unknown, maxCharacters: number): string | null {
  const text = typeof value === "string" ? normalizeHeading(value) : ""
  return text === "" ? null : text.slice(0, maxCharacters)
}

function markdownSectionSpans(text: string): StructuralSpan[] {
  const frontmatter = markdownFrontmatter(text)
  const bodyStart = frontmatter?.end ?? 0
  const lines = textLines(text)
  const headings: MarkdownHeading[] = []
  let fenceMarker: string | null = null

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line || line.start < bodyStart) {
      continue
    }
    const fence = FENCE_PATTERN.exec(line.text)?.[1]
    if (fence) {
      const marker = fence[0] ?? ""
      fenceMarker = fenceMarker === null ? marker : fenceMarker === marker ? null : fenceMarker
      continue
    }
    if (fenceMarker !== null) {
      continue
    }

    const atx = ATX_HEADING_PATTERN.exec(line.text)
    if (atx?.[1] && atx[2]) {
      headings.push({
        start: line.start,
        level: atx[1].length,
        title: normalizeHeading(atx[2]),
      })
      continue
    }

    const setext = SETEXT_HEADING_PATTERN.exec(line.text)
    const previous = lines[index - 1]
    if (setext?.[1] && previous && previous.start >= bodyStart && previous.text.trim()) {
      headings.push({
        start: previous.start,
        level: setext[1].startsWith("=") ? 1 : 2,
        title: normalizeHeading(previous.text),
      })
    }
  }

  if (headings.length === 0 && frontmatter === null) {
    return []
  }

  // A page without a level-1 heading, as Astro, Docusaurus, and Hugo write them, takes its front
  // matter title as the root of every section's context path.
  const root = headings.some((heading) => heading.level === 1) ? "" : (frontmatter?.title ?? "")
  const section = (charStart: number, charEnd: number, path: string[]): StructuralSpan => ({
    charStart,
    charEnd,
    contextPath: [root, ...path].filter(Boolean).join(" > "),
    kind: "markdown-section",
  })
  const spans: StructuralSpan[] = []
  if (frontmatter) {
    spans.push({ ...section(0, bodyStart, []), contextPath: frontmatter.title ?? root })
  }
  spans.push(section(bodyStart, headings[0]?.start ?? text.length, []))
  const hierarchy: string[] = []
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index]
    if (!heading) {
      continue
    }
    hierarchy.length = Math.max(0, heading.level - 1)
    hierarchy[heading.level - 1] = heading.title
    spans.push(section(heading.start, headings[index + 1]?.start ?? text.length, hierarchy))
  }
  return spans.filter((span) => span.charEnd > span.charStart)
}

function jsonNodeSpans(text: string, chunkSize: number): StructuralSpan[] {
  try {
    const parser = new JsonRangeParser(text)
    const root = parser.parse()
    const selected = selectJsonNodes(root, chunkSize)
    return groupJsonNodes(selected, chunkSize).map((node) => ({
      charStart: node.start,
      charEnd: node.end,
      contextPath: node.path,
      kind: "json-node" as const,
    }))
  } catch {
    return []
  }
}

function selectJsonNodes(node: JsonNode, chunkSize: number): JsonNode[] {
  if (node.end - node.start <= chunkSize || node.children.length === 0) {
    return [node]
  }
  return node.children.flatMap((child) => selectJsonNodes(child, chunkSize))
}

function groupJsonNodes(nodes: JsonNode[], chunkSize: number): JsonNode[] {
  const grouped: JsonNode[] = []
  for (const node of nodes) {
    const previous = grouped.at(-1)
    if (
      previous &&
      previous.parentPath === node.parentPath &&
      node.end - previous.start <= chunkSize
    ) {
      previous.end = node.end
      previous.path = node.parentPath
      continue
    }
    grouped.push({ ...node, children: [] })
  }
  return grouped
}

function jsonlEntrySpans(text: string, chunkSize: number): StructuralSpan[] {
  const spans: StructuralSpan[] = []
  let groupStart = -1
  let groupEnd = -1
  let firstLine = 0
  let lastLine = 0

  for (const [index, line] of textLines(text).entries()) {
    if (!line.text.trim()) {
      continue
    }
    try {
      JSON.parse(line.text)
    } catch {
      return []
    }
    if (groupStart >= 0 && line.contentEnd - groupStart > chunkSize) {
      spans.push(jsonlSpan(groupStart, groupEnd, firstLine, lastLine))
      groupStart = -1
    }
    if (groupStart < 0) {
      groupStart = line.start
      firstLine = index + 1
    }
    groupEnd = line.contentEnd
    lastLine = index + 1
  }

  if (groupStart >= 0) {
    spans.push(jsonlSpan(groupStart, groupEnd, firstLine, lastLine))
  }
  return spans
}

function jsonlSpan(
  start: number,
  end: number,
  firstLine: number,
  lastLine: number,
): StructuralSpan {
  return {
    charStart: start,
    charEnd: end,
    contextPath: firstLine === lastLine ? `$[${firstLine}]` : `$[${firstLine}..${lastLine}]`,
    kind: "jsonl-entry",
  }
}

function normalizeHeading(value: string): string {
  return value.replace(/\s+/gu, " ").trim()
}

function textLines(text: string): TextLine[] {
  const lines: TextLine[] = []
  let start = 0
  for (let index = 0; index <= text.length; index += 1) {
    if (index !== text.length && text[index] !== "\n") {
      continue
    }
    const hasNewline = index < text.length
    const contentEnd = index > start && text[index - 1] === "\r" ? index - 1 : index
    lines.push({
      start,
      end: hasNewline ? index + 1 : index,
      contentEnd,
      text: text.slice(start, contentEnd),
    })
    start = index + 1
  }
  return lines
}

class JsonRangeParser {
  private index = 0

  constructor(private readonly text: string) {}

  parse(): JsonNode {
    this.skipWhitespace()
    const node = this.parseValue("$", "")
    this.skipWhitespace()
    if (this.index !== this.text.length) {
      throw new Error("Unexpected JSON suffix.")
    }
    return node
  }

  private parseValue(path: string, parentPath: string): JsonNode {
    this.skipWhitespace()
    const start = this.index
    const current = this.text[this.index]
    if (current === "{") {
      return this.parseObject(path, parentPath, start)
    }
    if (current === "[") {
      return this.parseArray(path, parentPath, start)
    }
    if (current === '"') {
      this.parseString()
    } else {
      this.parsePrimitive()
    }
    return { start, end: this.index, path, parentPath, children: [] }
  }

  private parseObject(path: string, parentPath: string, start: number): JsonNode {
    this.index += 1
    const children: JsonNode[] = []
    this.skipWhitespace()
    while (this.text[this.index] !== "}") {
      const memberStart = this.index
      const key = this.parseString()
      this.skipWhitespace()
      this.expect(":")
      const childPath = appendJsonPath(path, key)
      const value = this.parseValue(childPath, path)
      children.push({ ...value, start: memberStart })
      this.skipWhitespace()
      if (this.text[this.index] !== ",") {
        break
      }
      this.index += 1
      this.skipWhitespace()
    }
    this.expect("}")
    return { start, end: this.index, path, parentPath, children }
  }

  private parseArray(path: string, parentPath: string, start: number): JsonNode {
    this.index += 1
    const children: JsonNode[] = []
    let itemIndex = 0
    this.skipWhitespace()
    while (this.text[this.index] !== "]") {
      const childPath = `${path}[${itemIndex}]`
      children.push(this.parseValue(childPath, path))
      itemIndex += 1
      this.skipWhitespace()
      if (this.text[this.index] !== ",") {
        break
      }
      this.index += 1
      this.skipWhitespace()
    }
    this.expect("]")
    return { start, end: this.index, path, parentPath, children }
  }

  private parseString(): string {
    const start = this.index
    this.expect('"')
    let escaped = false
    while (this.index < this.text.length) {
      const character = this.text[this.index]
      this.index += 1
      if (escaped) {
        escaped = false
        continue
      }
      if (character === "\\") {
        escaped = true
        continue
      }
      if (character === '"') {
        const parsed: unknown = JSON.parse(this.text.slice(start, this.index))
        if (typeof parsed !== "string") {
          throw new Error("Expected a JSON string.")
        }
        return parsed
      }
    }
    throw new Error("Unterminated JSON string.")
  }

  private parsePrimitive(): void {
    const start = this.index
    while (this.index < this.text.length && !/[\s,}\]]/u.test(this.text[this.index] ?? "")) {
      this.index += 1
    }
    JSON.parse(this.text.slice(start, this.index))
  }

  private skipWhitespace(): void {
    while (/\s/u.test(this.text[this.index] ?? "")) {
      this.index += 1
    }
  }

  private expect(character: string): void {
    if (this.text[this.index] !== character) {
      throw new Error(`Expected ${character}.`)
    }
    this.index += 1
  }
}

function appendJsonPath(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`
}

import { isRecord } from "./guards.js"
import type { StructuredSection } from "./structured-formats.js"
import {
  attribute,
  childElements,
  childText,
  collapseWhitespace,
  documentElement,
  firstChild,
  localName,
  multilineText,
  parseXmlTree,
  textContent,
  type XmlElement,
  type XmlNode,
} from "./xml-tree.js"

// A crafted map could nest topics deep enough to exhaust the stack: deeper branches are counted.
const MAX_TOPIC_DEPTH = 64
// Task progress and priority markers carry meaning as text; icons such as smileys are noise.
const MEANINGFUL_MARKER = /^(?:priority|task)-/u
const TOPIC_GROUPS = ["attached", "detached", "callout", "summary"] as const
const GROUP_PREFIX: Record<TopicGroup, string> = {
  attached: "",
  detached: "Floating topic: ",
  callout: "Callout: ",
  summary: "Summary: ",
}
const UNREADABLE =
  "XMind map content is not readable. Save a copy without a password, then ingest again."
const EMPTY_ELEMENT: XmlElement = { name: "", attributes: {}, children: [] }

type TopicGroup = (typeof TOPIC_GROUPS)[number]

interface MindTopic {
  title: string
  note: string
  labels: string[]
  markers: string[]
  link: string
  groups: Record<TopicGroup, MindTopic[]>
  // Branches below MAX_TOPIC_DEPTH that are left out.
  omitted: number
}

interface MindSheet {
  title: string
  root: MindTopic | null
  relationships: Array<{ from: string; to: string; title: string }>
}

/**
 * XMind map (`.xmind`): one section per sheet with its topic outline, notes, labels, task and
 * priority markers, web links, floating topics, and relationships. XMind 2020 and later keep the
 * map in `content.json`, XMind 8 in `content.xml`.
 */
export function xmindSections(entries: Map<string, string>): StructuredSection[] {
  const json = entries.get("content.json")
  const xml = entries.get("content.xml")
  if (json === undefined && xml === undefined) {
    throw new Error("XMind file has no content.json or content.xml.")
  }
  const sheets = json === undefined ? xmlSheets(xml ?? "") : jsonSheets(parsedJson(json))
  return sheets.flatMap((sheet, index) => {
    const title = sheet.title || `Sheet ${index + 1}`
    const text = sheetText(title, sheet)
    return text ? [{ label: `Sheet ${title}`, text }] : []
  })
}

function parsedJson(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    throw new Error(UNREADABLE)
  }
}

function jsonSheets(value: unknown): MindSheet[] {
  if (!Array.isArray(value)) {
    throw new Error(UNREADABLE)
  }
  return value.filter(isRecord).map((sheet) => {
    const titles = new Map<string, string>()
    const root = isRecord(sheet.rootTopic) ? jsonTopic(sheet.rootTopic, titles, 0) : null
    const relationships = (Array.isArray(sheet.relationships) ? sheet.relationships : [])
      .filter(isRecord)
      .map((relationship) => ({
        from: titles.get(stringOf(relationship.end1Id)) ?? "",
        to: titles.get(stringOf(relationship.end2Id)) ?? "",
        title: collapseWhitespace(stringOf(relationship.title)),
      }))
    return { title: collapseWhitespace(stringOf(sheet.title)), root, relationships }
  })
}

function jsonTopic(
  topic: Record<string, unknown>,
  titles: Map<string, string>,
  depth: number,
): MindTopic {
  const title = collapseWhitespace(stringOf(topic.title))
  const id = stringOf(topic.id)
  if (id) {
    titles.set(id, title)
  }
  const children = isRecord(topic.children) ? topic.children : {}
  const members = (group: TopicGroup): Record<string, unknown>[] => {
    const list = children[group]
    return Array.isArray(list) ? list.filter(isRecord) : []
  }
  const plain = isRecord(topic.notes) && isRecord(topic.notes.plain) ? topic.notes.plain : {}
  return {
    title,
    note: multilineText(stringOf(plain.content)),
    labels: (Array.isArray(topic.labels) ? topic.labels : [])
      .map((label) => collapseWhitespace(stringOf(label)))
      .filter(Boolean),
    markers: (Array.isArray(topic.markers) ? topic.markers : [])
      .filter(isRecord)
      .map((marker) => stringOf(marker.markerId))
      .filter((marker) => MEANINGFUL_MARKER.test(marker)),
    link: webLink(stringOf(topic.href)),
    ...nestedTopics(
      depth,
      (group) => members(group).length,
      (group) => members(group).map((child) => jsonTopic(child, titles, depth + 1)),
    ),
  }
}

function xmlSheets(xml: string): MindSheet[] {
  const root = documentElement(parseXmlTree(xml))
  if (!root || localName(root.name) !== "xmap-content") {
    throw new Error(UNREADABLE)
  }
  return childElements(root, "sheet").map((sheet) => {
    const titles = new Map<string, string>()
    const topic = firstChild(sheet, "topic")
    const rootTopic = topic ? xmlTopic(topic, titles, 0) : null
    const relationships = childElements(
      firstChild(sheet, "relationships") ?? EMPTY_ELEMENT,
      "relationship",
    ).map((relationship) => ({
      from: titles.get(attribute(relationship, "end1")) ?? "",
      to: titles.get(attribute(relationship, "end2")) ?? "",
      title: childText(relationship, "title"),
    }))
    return { title: childText(sheet, "title"), root: rootTopic, relationships }
  })
}

function xmlTopic(topic: XmlElement, titles: Map<string, string>, depth: number): MindTopic {
  const title = childText(topic, "title")
  const id = attribute(topic, "id")
  if (id) {
    titles.set(id, title)
  }
  const lists = childElements(firstChild(topic, "children") ?? EMPTY_ELEMENT, "topics")
  const members = (group: TopicGroup): XmlElement[] =>
    lists
      .filter((list) => attribute(list, "type") === group)
      .flatMap((list) => childElements(list, "topic"))
  const notes = firstChild(topic, "notes")
  return {
    title,
    note: multilineText(rawText(notes ? firstChild(notes, "plain") : undefined)),
    labels: childElements(firstChild(topic, "labels") ?? EMPTY_ELEMENT, "label")
      .map((label) => textContent(label))
      .filter(Boolean),
    markers: childElements(firstChild(topic, "marker-refs") ?? EMPTY_ELEMENT, "marker-ref")
      .map((marker) => attribute(marker, "marker-id"))
      .filter((marker) => MEANINGFUL_MARKER.test(marker)),
    link: webLink(attribute(topic, "href")),
    ...nestedTopics(
      depth,
      (group) => members(group).length,
      (group) => members(group).map((child) => xmlTopic(child, titles, depth + 1)),
    ),
  }
}

/** Child topics by group, or only their count once the depth limit is reached. */
function nestedTopics(
  depth: number,
  count: (group: TopicGroup) => number,
  read: (group: TopicGroup) => MindTopic[],
): Pick<MindTopic, "groups" | "omitted"> {
  const deep = depth >= MAX_TOPIC_DEPTH
  const groups: Record<TopicGroup, MindTopic[]> = {
    attached: [],
    detached: [],
    callout: [],
    summary: [],
  }
  let omitted = 0
  for (const group of TOPIC_GROUPS) {
    if (deep) {
      omitted += count(group)
    } else {
      groups[group] = read(group)
    }
  }
  return { groups, omitted }
}

function sheetText(title: string, sheet: MindSheet): string {
  const lines = [`Mind map: ${title}`]
  if (sheet.root) {
    renderTopic(sheet.root, 0, "", lines)
  }
  const relationships = sheet.relationships.filter((entry) => entry.from && entry.to)
  if (relationships.length > 0) {
    lines.push("Relationships:")
    for (const entry of relationships) {
      lines.push(`- ${entry.from} -> ${entry.to}${entry.title ? `: ${entry.title}` : ""}`)
    }
  }
  return lines.length > 1 ? lines.join("\n") : ""
}

function renderTopic(topic: MindTopic, depth: number, prefix: string, lines: string[]): void {
  const indent = "  ".repeat(depth)
  const detail = `${indent}  `
  lines.push(`${indent}- ${prefix}${topic.title || "(untitled topic)"}`)
  if (topic.labels.length > 0) {
    lines.push(`${detail}Labels: ${topic.labels.join(", ")}`)
  }
  if (topic.markers.length > 0) {
    lines.push(`${detail}Markers: ${topic.markers.join(", ")}`)
  }
  if (topic.link) {
    lines.push(`${detail}Link: ${topic.link}`)
  }
  topic.note
    .split("\n")
    .filter(Boolean)
    .forEach((line, index) => {
      lines.push(`${detail}${index === 0 ? "Note: " : "  "}${line}`)
    })
  for (const group of TOPIC_GROUPS) {
    for (const child of topic.groups[group]) {
      renderTopic(child, depth + 1, GROUP_PREFIX[group], lines)
    }
  }
  if (topic.omitted > 0) {
    lines.push(`${detail}(${topic.omitted} deeper branches not indexed)`)
  }
}

/** Text of a note element with its line breaks, unlike `textContent`. */
function rawText(element: XmlElement | undefined): string {
  if (!element) {
    return ""
  }
  const parts: string[] = []
  const pending: XmlNode[] = [...element.children].reverse()
  for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
    if (typeof current === "string") {
      parts.push(current)
    } else {
      pending.push(...[...current.children].reverse())
    }
  }
  return parts.join("")
}

// Only web and mail links are kept: internal topic links and attachment paths mean nothing alone.
function webLink(value: string): string {
  const link = value.trim()
  return /^(?:https?:\/\/|mailto:)/iu.test(link) ? link : ""
}

function stringOf(value: unknown): string {
  return typeof value === "string" ? value : ""
}

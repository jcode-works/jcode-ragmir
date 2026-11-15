import { isRecord } from "./guards.js"
import type { StructuredSection } from "./structured-formats.js"

/**
 * Whiteboards and design files: Excalidraw, tldraw, JSON Canvas (Obsidian), Sketch, and Figma
 * files exported through the REST API. Each frame, page, group, or artboard becomes one cited
 * section holding its text, labelled shapes, and labelled connections; geometry is dropped.
 */

interface PlacedText {
  text: string
  x: number
  y: number
}

const MAX_CONNECTION_END_CHARACTERS = 60

/** Excalidraw scene (`.excalidraw`, or a `.json` export whose `type` is "excalidraw"). */
export function excalidrawSections(value: unknown): StructuredSection[] | null {
  if (!isRecord(value) || value.type !== "excalidraw" || !Array.isArray(value.elements)) {
    return null
  }
  const elements = value.elements.filter(
    (element): element is Record<string, unknown> =>
      isRecord(element) && element.isDeleted !== true,
  )
  const byId = new Map(elements.map((element) => [stringField(element, "id"), element]))
  const boundText = new Map<string, string>()
  for (const element of elements) {
    const container = stringField(element, "containerId")
    if (element.type === "text" && container) {
      boundText.set(container, elementText(element))
    }
  }
  const labelOf = (id: string): string => {
    const element = byId.get(id)
    if (!element) {
      return ""
    }
    return boundText.get(id) ?? (element.type === "text" ? elementText(element) : "")
  }

  const frames = elements.filter(
    (element) => element.type === "frame" || element.type === "magicframe",
  )
  const frameNames = new Map(
    frames.map((frame, index) => [
      stringField(frame, "id"),
      stringField(frame, "name") || `Frame ${index + 1}`,
    ]),
  )
  const groups = new Map<string, { texts: PlacedText[]; connections: string[]; links: string[] }>()
  const groupFor = (element: Record<string, unknown>) => {
    const frameId = stringField(element, "frameId")
    const key = frameNames.has(frameId) ? frameId : ""
    let group = groups.get(key)
    if (!group) {
      group = { texts: [], connections: [], links: [] }
      groups.set(key, group)
    }
    return group
  }

  for (const element of elements) {
    const group = groupFor(element)
    const link = stringField(element, "link")
    if (link) {
      group.links.push(link)
    }
    if (element.type === "arrow" || element.type === "line") {
      const start = bindingTarget(element.startBinding)
      const end = bindingTarget(element.endBinding)
      const label = boundText.get(stringField(element, "id")) ?? ""
      const from = connectionEnd(labelOf(start))
      const to = connectionEnd(labelOf(end))
      if (from || to || label) {
        group.connections.push(connection(from, to, label))
      }
      continue
    }
    if (element.type === "text") {
      // Text bound to a shape or an arrow is reported as that shape's label or connection.
      if (!stringField(element, "containerId")) {
        pushPlaced(group.texts, elementText(element), element)
      }
      continue
    }
    const label = boundText.get(stringField(element, "id"))
    if (label) {
      pushPlaced(group.texts, label, element)
    }
  }

  const sections: StructuredSection[] = []
  // Frames in drawing order, then everything placed outside a frame.
  const keys = [...frameNames.keys(), ""]
  for (const key of keys) {
    const group = groups.get(key)
    if (!group) {
      continue
    }
    const name = key ? (frameNames.get(key) ?? "Frame") : "Canvas"
    const text = drawingText(
      key ? "Frame" : "Canvas",
      name,
      group.texts,
      group.connections,
      group.links,
    )
    if (text) {
      sections.push({ label: key ? `Frame ${name}` : "Canvas", text })
    }
  }
  return sections
}

/** tldraw document (`.tldr`): one section per page, with frame names, shape text, and arrows. */
export function tldrawSections(value: unknown): StructuredSection[] | null {
  if (
    !isRecord(value) ||
    typeof value.tldrawFileFormatVersion !== "number" ||
    !Array.isArray(value.records)
  ) {
    return null
  }
  const records = value.records.filter(isRecord)
  const pages = records
    .filter((record) => record.typeName === "page")
    .sort((left, right) => stringField(left, "index").localeCompare(stringField(right, "index")))
  const shapes = new Map(
    records
      .filter((record) => record.typeName === "shape")
      .map((shape) => [stringField(shape, "id"), shape]),
  )
  const pageOf = (shape: Record<string, unknown>): string => {
    let current: Record<string, unknown> | undefined = shape
    for (let depth = 0; current && depth < 64; depth += 1) {
      const parent = stringField(current, "parentId")
      if (parent.startsWith("page:")) {
        return parent
      }
      current = shapes.get(parent)
    }
    return ""
  }
  const ends = new Map<string, { start?: string; end?: string }>()
  for (const binding of records) {
    if (binding.typeName !== "binding" || binding.type !== "arrow") {
      continue
    }
    const arrow = stringField(binding, "fromId")
    const entry = ends.get(arrow) ?? {}
    const terminal = isRecord(binding.props) ? binding.props.terminal : undefined
    if (terminal === "start") {
      entry.start = stringField(binding, "toId")
    } else {
      entry.end = stringField(binding, "toId")
    }
    ends.set(arrow, entry)
  }
  const shapeText = (shape: Record<string, unknown> | undefined): string => {
    if (!shape || !isRecord(shape.props)) {
      return ""
    }
    const props = shape.props
    if (shape.type === "frame") {
      return typeof props.name === "string" ? props.name.trim() : ""
    }
    if (props.richText !== undefined) {
      return richText(props.richText)
    }
    return typeof props.text === "string" ? props.text.trim() : ""
  }

  const sections: StructuredSection[] = []
  for (const [index, page] of pages.entries()) {
    const pageId = stringField(page, "id")
    const name = stringField(page, "name") || `Page ${index + 1}`
    const texts: PlacedText[] = []
    const connections: string[] = []
    const frames: string[] = []
    for (const shape of shapes.values()) {
      if (pageOf(shape) !== pageId) {
        continue
      }
      const text = shapeText(shape)
      if (shape.type === "arrow") {
        const entry = ends.get(stringField(shape, "id"))
        const from = connectionEnd(shapeText(shapes.get(entry?.start ?? "")))
        const to = connectionEnd(shapeText(shapes.get(entry?.end ?? "")))
        if (from || to || text) {
          connections.push(connection(from, to, text))
        }
        continue
      }
      if (shape.type === "frame") {
        if (text) frames.push(`- ${text}`)
        continue
      }
      pushPlaced(texts, text, shape)
    }
    const body = drawingText("Page", name, texts, connections, [], frames)
    if (body) {
      sections.push({ label: `Page ${name}`, text: body })
    }
  }
  return sections
}

/** JSON Canvas (`.canvas`, Obsidian): one section per group, and one for ungrouped cards. */
export function jsonCanvasSections(value: unknown): StructuredSection[] | null {
  if (!isRecord(value) || !Array.isArray(value.nodes)) {
    return null
  }
  const nodes = value.nodes.filter(isRecord)
  const canvasNode = (node: Record<string, unknown>) =>
    typeof node.id === "string" &&
    ["text", "file", "link", "group"].includes(String(node.type)) &&
    typeof node.x === "number" &&
    typeof node.y === "number"
  if (nodes.length === 0 || !nodes.every(canvasNode)) {
    return null
  }
  const edges = Array.isArray(value.edges) ? value.edges.filter(isRecord) : []
  const groups = nodes.filter((node) => node.type === "group")
  const groupOf = new Map<string, string>()
  for (const node of nodes) {
    if (node.type === "group") {
      continue
    }
    // The smallest group whose rectangle holds the card owns it.
    let owner: Record<string, unknown> | undefined
    for (const group of groups) {
      if (contains(group, node) && (!owner || area(group) < area(owner))) {
        owner = group
      }
    }
    if (owner) {
      groupOf.set(stringField(node, "id"), stringField(owner, "id"))
    }
  }
  const nodeById = new Map(nodes.map((node) => [stringField(node, "id"), node]))
  const shortName = (id: string): string => {
    const node = nodeById.get(id)
    if (!node) {
      return ""
    }
    return connectionEnd(canvasNodeText(node).split("\n")[0] ?? "")
  }
  // Groups first, as frames are in Excalidraw, then the cards placed outside any group.
  const sectionKeys = [...groups.map((group) => stringField(group, "id")), ""]
  const sections: StructuredSection[] = []
  for (const key of sectionKeys) {
    const group = key ? nodeById.get(key) : undefined
    const name = group ? stringField(group, "label") || "Group" : "Canvas"
    const texts: PlacedText[] = []
    for (const node of nodes) {
      if (node.type === "group" || (groupOf.get(stringField(node, "id")) ?? "") !== key) {
        continue
      }
      pushPlaced(texts, canvasNodeText(node), node)
    }
    const connections = edges
      .filter((edge) => (groupOf.get(stringField(edge, "fromNode")) ?? "") === key)
      .map((edge) =>
        connection(
          shortName(stringField(edge, "fromNode")),
          shortName(stringField(edge, "toNode")),
          stringField(edge, "label"),
        ),
      )
    const text = drawingText(group ? "Group" : "Canvas", name, texts, connections, [])
    if (text) {
      sections.push({ label: group ? `Group ${name}` : "Canvas", text })
    }
  }
  return sections
}

/** Sketch document (`.sketch`): one section per artboard or symbol, and one per page remainder. */
export function sketchSections(entries: Map<string, string>): StructuredSection[] {
  const pageNames = [...entries.keys()].filter((name) => /^pages\/[^/]+\.json$/u.test(name)).sort()
  if (pageNames.length === 0) {
    throw new Error("Sketch document has no pages.")
  }
  const sections: StructuredSection[] = []
  for (const pageName of pageNames) {
    const page: unknown = JSON.parse(entries.get(pageName) ?? "null")
    if (!isRecord(page)) {
      continue
    }
    const pageTitle = stringField(page, "name") || "Page"
    const loose: PlacedText[] = []
    for (const layer of layersOf(page)) {
      const kind = stringField(layer, "_class")
      if (kind === "artboard" || kind === "symbolMaster") {
        const name = stringField(layer, "name") || (kind === "artboard" ? "Artboard" : "Symbol")
        const texts: PlacedText[] = []
        collectSketchText(layer, texts, 0)
        const label = `${kind === "artboard" ? "Artboard" : "Symbol"} ${pageTitle} / ${name}`
        const text = drawingText(
          kind === "artboard" ? "Artboard" : "Symbol",
          `${pageTitle} / ${name}`,
          texts,
          [],
          [],
        )
        if (text) {
          sections.push({ label, text })
        }
        continue
      }
      collectSketchText(layer, loose, 0)
    }
    const text = drawingText("Page", pageTitle, loose, [], [])
    if (loose.length > 0 && text) {
      sections.push({ label: `Page ${pageTitle}`, text })
    }
  }
  return sections
}

/**
 * Figma file JSON from the REST API (`GET /v1/files/:key`): one section per top-level frame,
 * section, or component of each page, with its text layers and component descriptions.
 */
export function figmaSections(value: unknown): StructuredSection[] | null {
  if (
    !isRecord(value) ||
    !isRecord(value.document) ||
    value.document.type !== "DOCUMENT" ||
    !Array.isArray(value.document.children)
  ) {
    return null
  }
  const descriptions = new Map<string, string>()
  for (const table of [value.components, value.componentSets]) {
    if (!isRecord(table)) {
      continue
    }
    for (const [id, component] of Object.entries(table)) {
      if (isRecord(component) && typeof component.description === "string") {
        descriptions.set(id, component.description.trim())
      }
    }
  }
  const sections: StructuredSection[] = []
  for (const page of value.document.children.filter(isRecord)) {
    const pageName = stringField(page, "name") || "Page"
    const loose: string[] = []
    for (const node of Array.isArray(page.children) ? page.children.filter(isRecord) : []) {
      if (node.visible === false) {
        continue
      }
      if (node.type === "TEXT" || node.type === "STICKY" || node.type === "SHAPE_WITH_TEXT") {
        const text = stringField(node, "characters")
        if (text) loose.push(text)
        continue
      }
      const nodeName = stringField(node, "name") || String(node.type ?? "Node")
      const texts: string[] = []
      collectFigmaText(node, texts, descriptions, 0)
      const kind = figmaKind(node.type)
      const body = [`${kind}: ${pageName} / ${nodeName}`, ...unique(texts)].join("\n")
      sections.push({ label: `${kind} ${pageName} / ${nodeName}`, text: body })
    }
    if (loose.length > 0) {
      sections.push({
        label: `Page ${pageName}`,
        text: [`Page: ${pageName}`, ...unique(loose)].join("\n"),
      })
    }
  }
  return sections
}

function collectFigmaText(
  node: Record<string, unknown>,
  texts: string[],
  descriptions: Map<string, string>,
  depth: number,
): void {
  if (depth > 64 || node.visible === false) {
    return
  }
  const characters = stringField(node, "characters")
  if (characters) {
    texts.push(characters)
  }
  // An instance documents itself with its main component's description.
  const description =
    descriptions.get(stringField(node, "id")) ?? descriptions.get(stringField(node, "componentId"))
  if (description) {
    texts.push(`${stringField(node, "name")}: ${description}`)
  }
  if (node.type === "INSTANCE" || node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
    const name = stringField(node, "name")
    if (name && depth > 0) texts.push(`Component: ${name}`)
  }
  for (const child of Array.isArray(node.children) ? node.children.filter(isRecord) : []) {
    collectFigmaText(child, texts, descriptions, depth + 1)
  }
}

function figmaKind(type: unknown): string {
  switch (type) {
    case "SECTION":
      return "Section"
    case "COMPONENT":
    case "COMPONENT_SET":
      return "Component"
    case "GROUP":
      return "Group"
    case "SLIDE":
      return "Slide"
    default:
      return "Frame"
  }
}

function collectSketchText(
  layer: Record<string, unknown>,
  texts: PlacedText[],
  depth: number,
): void {
  if (depth > 64 || layer.isVisible === false) {
    return
  }
  const kind = stringField(layer, "_class")
  if (kind === "text") {
    const attributed = isRecord(layer.attributedString) ? layer.attributedString : {}
    pushPlaced(
      texts,
      stringField(attributed, "string") || stringField(layer, "name"),
      frameOf(layer),
    )
  } else if (kind === "symbolInstance" && Array.isArray(layer.overrideValues)) {
    for (const override of layer.overrideValues.filter(isRecord)) {
      if (
        typeof override.value === "string" &&
        stringField(override, "overrideName").endsWith("_stringValue")
      ) {
        pushPlaced(texts, override.value, frameOf(layer))
      }
    }
  }
  for (const child of layersOf(layer)) {
    collectSketchText(child, texts, depth + 1)
  }
}

function layersOf(value: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(value.layers) ? value.layers.filter(isRecord) : []
}

function frameOf(layer: Record<string, unknown>): Record<string, unknown> {
  return isRecord(layer.frame) ? layer.frame : {}
}

function canvasNodeText(node: Record<string, unknown>): string {
  switch (node.type) {
    case "text":
      return stringField(node, "text")
    case "file":
      return `File: ${stringField(node, "file")}${stringField(node, "subpath")}`
    case "link":
      return `Link: ${stringField(node, "url")}`
    default:
      return stringField(node, "label")
  }
}

function contains(group: Record<string, unknown>, node: Record<string, unknown>): boolean {
  const x = numberField(node, "x")
  const y = numberField(node, "y")
  const gx = numberField(group, "x")
  const gy = numberField(group, "y")
  return (
    x >= gx &&
    y >= gy &&
    x + numberField(node, "width") <= gx + numberField(group, "width") &&
    y + numberField(node, "height") <= gy + numberField(group, "height")
  )
}

function area(node: Record<string, unknown>): number {
  return numberField(node, "width") * numberField(node, "height")
}

function bindingTarget(value: unknown): string {
  return isRecord(value) && typeof value.elementId === "string" ? value.elementId : ""
}

function elementText(element: Record<string, unknown>): string {
  return (stringField(element, "originalText") || stringField(element, "text")).trim()
}

/** Plain text of a TipTap rich-text document, one line per block. */
function richText(value: unknown, depth = 0): string {
  if (depth > 32 || !isRecord(value)) {
    return ""
  }
  if (typeof value.text === "string") {
    return value.text
  }
  const content = Array.isArray(value.content) ? value.content : []
  const parts = content.map((child) => richText(child, depth + 1))
  const block = value.type === "doc" || value.type === "bulletList" || value.type === "orderedList"
  return parts.join(block ? "\n" : "").trim()
}

function pushPlaced(texts: PlacedText[], text: string, position: Record<string, unknown>): void {
  const trimmed = text.trim()
  if (trimmed) {
    texts.push({ text: trimmed, x: numberField(position, "x"), y: numberField(position, "y") })
  }
}

/** Reading order: top to bottom, then left to right. */
function readingOrder(texts: PlacedText[]): string[] {
  return unique(
    [...texts]
      .sort((left, right) => left.y - right.y || left.x - right.x)
      .map((entry) => entry.text),
  )
}

function drawingText(
  kind: string,
  name: string,
  texts: PlacedText[],
  connections: string[],
  links: string[],
  frames: string[] = [],
): string {
  const ordered = readingOrder(texts)
  if (
    ordered.length === 0 &&
    connections.length === 0 &&
    links.length === 0 &&
    frames.length === 0
  ) {
    return ""
  }
  return [
    `${kind}: ${name}`,
    ...(frames.length > 0 ? ["Frames:", ...unique(frames)] : []),
    ...ordered,
    ...(connections.length > 0 ? ["Connections:", ...unique(connections)] : []),
    ...(links.length > 0 ? ["Links:", ...unique(links).map((link) => `- ${link}`)] : []),
  ].join("\n")
}

function connection(from: string, to: string, label: string): string {
  return `- ${from || "?"} -> ${to || "?"}${label ? `: ${label.replace(/\s+/gu, " ").trim()}` : ""}`
}

function connectionEnd(text: string): string {
  const line = text.replace(/\s+/gu, " ").trim()
  return line.length > MAX_CONNECTION_END_CHARACTERS
    ? `${line.slice(0, MAX_CONNECTION_END_CHARACTERS - 1).trimEnd()}…`
    : line
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === "string" ? value.trim() : ""
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

import { inflateRawSync } from "node:zlib"
import { htmlToText } from "html-to-text"
import {
  attribute,
  childElements,
  childText,
  collapseWhitespace,
  descendants,
  documentElement,
  firstChild,
  localName,
  multilineText,
  parseXmlTree,
  textContent,
  type XmlElement,
} from "./xml-tree.js"

/** One cited object of a structured export: a table, a diagram page, a decision, an operation. */
export interface StructuredSection {
  label: string
  text: string
}

export type StructuredXmlFormat =
  | "powerdesigner"
  | "erwin"
  | "mysql-workbench"
  | "oracle-data-modeler"
  | "drawio"
  | "bpmn"
  | "dmn"
  | "archimate"
  | "xmi"
  | "tableau"

// One export can hold thousands of objects; the rest are summarised in a last section.
const MAX_STRUCTURED_SECTIONS = 20_000
// A compressed draw.io page is inflated in memory, so its expanded size is bounded.
const MAX_DIAGRAM_INFLATED_BYTES = 25_000_000

const HEAD_BYTES = 8_192

/**
 * Recognise a structured export from its first bytes: a PowerDesigner processing instruction or a
 * root element and namespace. Generic XML returns null and keeps its line-cited plain text.
 */
export function detectStructuredXml(xml: string): StructuredXmlFormat | null {
  const head = xml.slice(0, HEAD_BYTES)
  if (/<\?PowerDesigner\b/u.test(head)) {
    return "powerdesigner"
  }
  const root = rootStartTag(head)
  if (!root) {
    return null
  }
  const name = localName(root.name)
  const attributes = root.attributes
  if (name === "mxfile" || name === "mxGraphModel") {
    return "drawio"
  }
  if (/omg\.org\/spec\/BPMN\/[^"']*\/MODEL/iu.test(attributes)) {
    return "bpmn"
  }
  if (/omg\.org\/spec\/DMN\//iu.test(attributes) && name === "definitions") {
    return "dmn"
  }
  if (
    /opengroup\.org\/xsd\/archimate/iu.test(attributes) ||
    /archimatetool\.com\/archimate/iu.test(attributes)
  ) {
    return "archimate"
  }
  if (name === "XMI" || /\bxmi:version\s*=/u.test(attributes)) {
    return "xmi"
  }
  if (name === "data" && /\bgrt_format\s*=/u.test(attributes)) {
    return "mysql-workbench"
  }
  if (/\bclass\s*=\s*["']oracle\.dbtools\.crest\./u.test(attributes)) {
    return "oracle-data-modeler"
  }
  if (/^erwin/iu.test(name)) {
    return "erwin"
  }
  if (name === "workbook" && /\bsource-build\s*=/u.test(attributes)) {
    return "tableau"
  }
  return null
}

export function structuredXmlSections(
  xml: string,
  format: StructuredXmlFormat,
): StructuredSection[] {
  const document = parseXmlTree(xml)
  switch (format) {
    case "powerdesigner":
      return powerDesignerSections(document)
    case "erwin":
      return erwinSections(document)
    case "mysql-workbench":
      return mysqlWorkbenchSections(document)
    case "oracle-data-modeler":
      return oracleDataModelerSections(document)
    case "drawio":
      return drawioSections(document)
    case "bpmn":
      return bpmnSections(document)
    case "dmn":
      return dmnSections(document)
    case "archimate":
      return archimateSections(document)
    case "xmi":
      return xmiSections(document)
    case "tableau":
      return tableauSections(document)
  }
}

/** Keeps the first sections and records how many objects were left out. */
export function boundedSections(sections: StructuredSection[]): StructuredSection[] {
  if (sections.length <= MAX_STRUCTURED_SECTIONS) {
    return sections
  }
  const kept = sections.slice(0, MAX_STRUCTURED_SECTIONS - 1)
  kept.push({
    label: "Omitted objects",
    text: `${sections.length - kept.length} more objects are not indexed (limit ${MAX_STRUCTURED_SECTIONS}).`,
  })
  return kept
}

function rootStartTag(head: string): { name: string; attributes: string } | null {
  const pattern = /<([A-Za-z_][\w.:-]*)([^>]*)>/gu
  for (const match of head.matchAll(pattern)) {
    const before = head.slice(0, match.index)
    // Skip tags inside a leading comment or DOCTYPE.
    if (before.lastIndexOf("<!--") > before.lastIndexOf("-->")) {
      continue
    }
    return { name: match[1] ?? "", attributes: match[2] ?? "" }
  }
  return null
}

function lines(...values: Array<string | false | null | undefined>): string {
  return values.filter((value): value is string => Boolean(value)).join("\n")
}

function property(label: string, value: string): string {
  const text = value.trim()
  return text ? `${label}: ${text}` : ""
}

function nameWithCode(name: string, code: string): string {
  if (!name) {
    return code
  }
  return code && code !== name ? `${name} (${code})` : name
}

/** "ParentTable" or "Key.Columns" becomes "Parent table" or "Key columns". */
function humanize(value: string): string {
  const spaced = value
    .replace(/[._-]+/gu, " ")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
    .trim()
    .toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function plainRtf(value: string): string {
  if (!value.startsWith("{\\rtf")) {
    return value
  }
  return multilineText(
    value
      .replace(/\{\\\*[^{}]*\}/gu, " ")
      .replace(/\\par[d]?\b/gu, "\n")
      .replace(/\\'[0-9a-fA-F]{2}/gu, " ")
      .replace(/\\[a-zA-Z]+-?\d* ?/gu, " ")
      .replace(/[{}]/gu, " "),
  )
}

function htmlLabel(value: string): string {
  if (!/[<&]/u.test(value)) {
    return collapseWhitespace(value)
  }
  return collapseWhitespace(
    htmlToText(value, { wordwrap: false, selectors: [{ selector: "img", format: "skip" }] }),
  )
}

// PowerDesigner: CDM, LDM, PDM, OOM, and BPM models saved as XML.

const PD_CONTAINER_KINDS = new Set(["Model", "Package", "RootObject"])
const PD_SKIPPED_KINDS =
  /(?:Symbol|Diagram|ReportItem|Report|Paragraph|Tabulation|ListRowDefinition|ExtendedCollection|ExtendedComposition|ExtendedModelDefinition|PersistentSelection|PersistentSelectionManager|TargetModel|Shortcut|Group|User|DataItem|GenerationOrigin|ExtendedDependency|Dependency)$/u
const PD_SKIPPED_COLLECTIONS =
  /(?:Symbols|Diagrams|ExtendedCollections|ExtendedCompositions|ExtendedModelDefinitions|ExtendedAttributesText|GenerationOrigins|TargetModels|DefaultDiagram|Report|Reports)$/u
const PD_PROPERTIES: ReadonlyArray<[string, string]> = [
  ["Stereotype", "Stereotype"],
  ["DataType", "Type"],
  ["Length", "Length"],
  ["Precision", "Precision"],
  ["DefaultValue", "Default"],
  ["LowValue", "Minimum"],
  ["HighValue", "Maximum"],
  ["ListOfValues", "Values"],
  ["Cardinality", "Cardinality"],
  ["Multiplicity", "Multiplicity"],
  ["Visibility", "Visibility"],
  ["ReturnType", "Returns"],
  ["ConstraintName", "Constraint"],
  ["ForeignKeyConstraintName", "Foreign key"],
  ["ServerExpression", "Expression"],
  ["ClientExpression", "Client expression"],
  ["Comment", "Comment"],
  ["Description", "Description"],
  ["Annotation", "Annotation"],
]

interface PowerDesignerLink {
  first: string
  second: string
  detail: string
}

function powerDesignerSections(document: XmlElement): StructuredSection[] {
  const objects = new Map<string, XmlElement>()
  for (const element of descendants(document)) {
    const id = element.attributes.Id
    if (id && element.name.startsWith("o:")) {
      objects.set(id, element)
    }
  }

  const primaries: XmlElement[] = []
  const links: PowerDesignerLink[] = []
  let model: XmlElement | undefined
  const visit = (element: XmlElement): void => {
    for (const child of childElements(element)) {
      if (!child.name.startsWith("o:")) {
        if (!PD_SKIPPED_COLLECTIONS.test(localName(child.name))) {
          visit(child)
        }
        continue
      }
      if (!child.attributes.Id) {
        continue
      }
      const kind = localName(child.name)
      if (PD_CONTAINER_KINDS.has(kind)) {
        if (kind === "Model" && !model) {
          model = child
        }
        if (kind === "Package") {
          primaries.push(child)
        }
        visit(child)
        continue
      }
      if (PD_SKIPPED_KINDS.test(kind)) {
        continue
      }
      if (firstChild(child, "a:Name")) {
        primaries.push(child)
        continue
      }
      const first = pdReference(child, "c:Object1")
      const second = pdReference(child, "c:Object2")
      if (first && second) {
        links.push({ first, second, detail: pdProperties(child).join(", ") })
      }
    }
  }
  visit(document)

  const linksByObject = new Map<string, string[]>()
  for (const link of links) {
    const describe = (id: string) => pdLabel(objects.get(id))
    for (const [own, other] of [
      [link.first, link.second],
      [link.second, link.first],
    ] as const) {
      const entry = `${describe(other)}${link.detail ? ` (${link.detail})` : ""}`
      linksByObject.set(own, [...(linksByObject.get(own) ?? []), entry])
    }
  }

  // Reverse index: a table lists the references that point at it, an entity its inheritances.
  const primaryIds = new Set(primaries.map((primary) => primary.attributes.Id ?? ""))
  const referencedBy = new Map<string, Set<string>>()
  for (const primary of primaries) {
    for (const collection of childElements(primary)) {
      if (!collection.name.startsWith("c:")) {
        continue
      }
      for (const reference of childElements(collection)) {
        const target = reference.attributes.Ref ?? ""
        if (target && target !== primary.attributes.Id && primaryIds.has(target)) {
          const entries = referencedBy.get(target) ?? new Set<string>()
          entries.add(pdLabel(primary))
          referencedBy.set(target, entries)
        }
      }
    }
  }

  const sections: StructuredSection[] = []
  if (model) {
    const counts = new Map<string, number>()
    for (const primary of primaries) {
      const kind = humanize(localName(primary.name)).toLowerCase()
      counts.set(kind, (counts.get(kind) ?? 0) + 1)
    }
    sections.push({
      label: `Model ${childText(model, "a:Code") || childText(model, "a:Name")}`,
      text: lines(
        `Model: ${nameWithCode(childText(model, "a:Name"), childText(model, "a:Code"))}`,
        ...pdProperties(model),
        counts.size > 0
          ? `Objects: ${[...counts].map(([kind, count]) => `${count} ${kind}`).join(", ")}`
          : "",
      ),
    })
  }

  for (const primary of primaries) {
    const kind = humanize(localName(primary.name))
    const name = childText(primary, "a:Name")
    const code = childText(primary, "a:Code")
    const body: string[] = [`${kind}: ${nameWithCode(name, code)}`, ...pdProperties(primary)]
    if (localName(primary.name) !== "Package") {
      for (const collection of childElements(primary)) {
        if (!collection.name.startsWith("c:") || PD_SKIPPED_COLLECTIONS.test(collection.name)) {
          continue
        }
        body.push(...pdCollection(collection, objects))
      }
    }
    const users = referencedBy.get(primary.attributes.Id ?? "")
    if (users && users.size > 0) {
      body.push("Referenced by:", ...[...users].map((entry) => `- ${entry}`))
    }
    const linked = linksByObject.get(primary.attributes.Id ?? "")
    if (linked && linked.length > 0) {
      body.push("Links:", ...linked.map((entry) => `- ${entry}`))
    }
    sections.push({ label: `${kind} ${code || name}`, text: lines(...body) })
  }
  return sections
}

function pdProperties(element: XmlElement): string[] {
  const values: string[] = []
  const flags: string[] = []
  for (const child of childElements(element)) {
    if (!child.name.startsWith("a:")) {
      continue
    }
    const key = localName(child.name)
    const value = textContent(child)
    if (/(?:^|\.)Mandatory$/u.test(key) && value === "1") {
      flags.push("mandatory")
    } else if (/(?:^|\.)Primary$/u.test(key) && value === "1") {
      flags.push("primary")
    } else if (/(?:^|\.)Identity$/u.test(key) && value === "1") {
      flags.push("identity")
    }
  }
  for (const [key, label] of PD_PROPERTIES) {
    const child = firstChild(element, `a:${key}`)
    if (!child) {
      continue
    }
    const raw = childTextRaw(child)
    const value =
      key === "Comment" || key === "Description" || key === "Annotation"
        ? multilineText(plainRtf(raw.trim()))
        : collapseWhitespace(raw)
    if (value) {
      values.push(`${label}: ${value}`)
    }
  }
  if (flags.length > 0) {
    values.push(flags.join(", "))
  }
  return values
}

function childTextRaw(element: XmlElement): string {
  return element.children.map((child) => (typeof child === "string" ? child : "")).join("")
}

function pdReference(element: XmlElement, collection: string): string {
  const container = firstChild(element, collection)
  const reference = container ? childElements(container)[0] : undefined
  return reference?.attributes.Ref ?? reference?.attributes.Id ?? ""
}

function pdLabel(element: XmlElement | undefined): string {
  if (!element) {
    return "unknown"
  }
  const name = childText(element, "a:Name")
  const code = childText(element, "a:Code")
  return `${humanize(localName(element.name))} ${nameWithCode(name, code)}`.trim()
}

function pdShortLabel(element: XmlElement | undefined, objects: Map<string, XmlElement>): string {
  if (!element) {
    return ""
  }
  const name = childText(element, "a:Name")
  const code = childText(element, "a:Code")
  if (name || code) {
    return nameWithCode(name, code)
  }
  // Nameless sub-objects (an entity attribute, an index column) borrow their target's name.
  for (const collection of childElements(element)) {
    for (const reference of childElements(collection)) {
      const target = reference.attributes.Ref ? objects.get(reference.attributes.Ref) : undefined
      if (target && target !== element) {
        return pdShortLabel(target, objects)
      }
    }
  }
  return ""
}

function pdCollection(collection: XmlElement, objects: Map<string, XmlElement>): string[] {
  const items = childElements(collection).filter((item) => item.name.startsWith("o:"))
  if (items.length === 0) {
    return []
  }
  const title = humanize(localName(collection.name))
  const references = items.filter((item) => item.attributes.Ref)
  if (references.length === items.length) {
    const names = references
      .map((item) => pdShortLabel(objects.get(item.attributes.Ref ?? ""), objects))
      .filter(Boolean)
    return names.length > 0 ? [`${title}: ${names.join(", ")}`] : []
  }
  const rows = items
    .filter((item) => item.attributes.Id && !PD_SKIPPED_KINDS.test(localName(item.name)))
    .map((item) => `- ${pdInline(item, objects)}`)
    .filter((row) => row !== "- ")
  return rows.length > 0 ? [`${title}:`, ...rows] : []
}

function pdInline(element: XmlElement, objects: Map<string, XmlElement>): string {
  let label = nameWithCode(childText(element, "a:Name"), childText(element, "a:Code"))
  const details: string[] = []
  const first = pdReference(element, "c:Object1")
  const second = pdReference(element, "c:Object2")
  if (!label && first && second) {
    label = `${pdShortLabel(objects.get(first), objects)} = ${pdShortLabel(objects.get(second), objects)}`
  }
  for (const collection of childElements(element)) {
    if (!collection.name.startsWith("c:") || PD_SKIPPED_COLLECTIONS.test(collection.name)) {
      continue
    }
    const key = localName(collection.name)
    if (key === "Object1" || key === "Object2") {
      continue
    }
    for (const reference of childElements(collection)) {
      const target = reference.attributes.Ref ? objects.get(reference.attributes.Ref) : undefined
      if (!target) {
        continue
      }
      if (!label && key === "DataItem") {
        // A conceptual attribute is a reference to its data item: show the item itself.
        label = nameWithCode(childText(target, "a:Name"), childText(target, "a:Code"))
        details.push(...pdProperties(target).filter((value) => !value.startsWith("Comment:")))
        const comment = childText(target, "a:Comment")
        if (comment) {
          details.push(`Comment: ${comment}`)
        }
        const domain = pdReference(target, "c:Domain")
        if (domain) {
          details.push(`Domain: ${pdShortLabel(objects.get(domain), objects)}`)
        }
        continue
      }
      details.push(`${humanize(key)}: ${pdShortLabel(target, objects)}`)
    }
  }
  details.unshift(...pdProperties(element))
  if (!label) {
    label = details.shift() ?? ""
  }
  return details.length > 0 ? `${label}: ${details.join("; ")}` : label
}

// ERwin Data Modeler XML exports.

function erwinValue(element: XmlElement, names: string[]): string {
  for (const name of names) {
    const direct = attribute(element, name) || attribute(element, name.toLowerCase())
    if (direct) {
      return direct
    }
    const child = firstChild(element, name)
    if (child) {
      return textContent(child)
    }
    for (const props of childElements(element)) {
      if (/Props$/u.test(localName(props.name))) {
        const nested = firstChild(props, name)
        if (nested) {
          return textContent(nested)
        }
      }
    }
  }
  return ""
}

function erwinSections(document: XmlElement): StructuredSection[] {
  const byId = new Map<string, XmlElement>()
  for (const element of descendants(document)) {
    const id = attribute(element, "id")
    if (id) {
      byId.set(id, element)
    }
  }
  const nameOf = (id: string) => {
    const target = byId.get(id)
    return target ? erwinValue(target, ["Name"]) || id : id
  }
  const sections: StructuredSection[] = []
  for (const entity of descendants(document, "Entity")) {
    const name = erwinValue(entity, ["Name"])
    if (!name) {
      continue
    }
    const physical = erwinValue(entity, ["Physical_Name"])
    const attributes = descendants(entity, "Attribute")
      .map((item) => {
        const attributeName = erwinValue(item, ["Name"])
        if (!attributeName) {
          return ""
        }
        const details = [
          property("physical", erwinValue(item, ["Physical_Name"])),
          property(
            "type",
            erwinValue(item, ["Physical_Data_Type", "Logical_Data_Type", "Datatype"]),
          ),
          erwinValue(item, ["Null_Option", "Null_Option_Type"]) === "1" ? "not null" : "",
          property("definition", erwinValue(item, ["Definition", "Comment"])),
        ].filter(Boolean)
        return `- ${attributeName}${details.length > 0 ? `: ${details.join("; ")}` : ""}`
      })
      .filter(Boolean)
    sections.push({
      label: `Entity ${physical || name}`,
      text: lines(
        `Entity: ${nameWithCode(name, physical)}`,
        property("Definition", erwinValue(entity, ["Definition"])),
        property("Comment", erwinValue(entity, ["Comment", "Note"])),
        attributes.length > 0 ? "Attributes:" : "",
        ...attributes,
      ),
    })
  }
  for (const relationship of descendants(document, "Relationship")) {
    const parent = erwinValue(relationship, ["Parent_Entity", "Parent_Entity_Ref"])
    const child = erwinValue(relationship, ["Child_Entity", "Child_Entity_Ref"])
    if (!parent && !child) {
      continue
    }
    const name = erwinValue(relationship, ["Name"]) || `${nameOf(parent)} to ${nameOf(child)}`
    sections.push({
      label: `Relationship ${name}`,
      text: lines(
        `Relationship: ${name}`,
        property("Parent", nameOf(parent)),
        property("Child", nameOf(child)),
        property(
          "Verb phrase",
          erwinValue(relationship, ["Verb_Phrase", "Parent_To_Child_Verb_Phrase"]),
        ),
        property("Cardinality", erwinValue(relationship, ["Cardinality"])),
        property("Definition", erwinValue(relationship, ["Definition"])),
      ),
    })
  }
  return sections
}

// MySQL Workbench: document.mwb.xml inside the .mwb archive, in the GRT object format.

function grtValue(element: XmlElement, key: string): XmlElement | undefined {
  return childElements(element).find((child) => attribute(child, "key") === key)
}

function grtText(element: XmlElement, key: string): string {
  return textContent(grtValue(element, key))
}

function grtObjects(element: XmlElement | undefined): XmlElement[] {
  return element
    ? childElements(element).filter((child) => attribute(child, "type") === "object")
    : []
}

function mysqlWorkbenchSections(document: XmlElement): StructuredSection[] {
  const byId = new Map<string, XmlElement>()
  for (const element of descendants(document, "value")) {
    const id = attribute(element, "id")
    if (id) {
      byId.set(id, element)
    }
  }
  const nameOfLink = (element: XmlElement | undefined) => {
    const target = element ? byId.get(textContent(element)) : undefined
    return target ? grtText(target, "name") : ""
  }
  const sections: StructuredSection[] = []
  for (const object of descendants(document, "value")) {
    const struct = attribute(object, "struct-name")
    const kind = /^db\.(?:\w+\.)?(Table|View|Routine)$/u.exec(struct)?.[1]
    if (!kind || attribute(object, "type") !== "object") {
      continue
    }
    const name = grtText(object, "name")
    if (!name) {
      continue
    }
    const body = [`${kind}: ${name}`, property("Comment", grtText(object, "comment"))]
    if (kind === "Table") {
      const columns = grtObjects(grtValue(object, "columns")).map((column) => {
        const type = textContent(grtValue(column, "simpleType")).split(".").pop() ?? ""
        const length = grtText(column, "length")
        const details = [
          type ? `${type}${length && length !== "-1" ? `(${length})` : ""}` : "",
          grtText(column, "isNotNull") === "1" ? "not null" : "",
          grtText(column, "autoIncrement") === "1" ? "auto increment" : "",
          property("default", grtText(column, "defaultValue")),
          property("comment", grtText(column, "comment")),
        ].filter(Boolean)
        return `- ${grtText(column, "name")}${details.length > 0 ? `: ${details.join("; ")}` : ""}`
      })
      if (columns.length > 0) {
        body.push("Columns:", ...columns)
      }
      const keys = grtObjects(grtValue(object, "foreignKeys")).map((key) => {
        const own = childElements(grtValue(key, "columns") ?? key)
          .map((link) => nameOfLink(link))
          .filter(Boolean)
        const referenced = childElements(grtValue(key, "referencedColumns") ?? key)
          .map((link) => nameOfLink(link))
          .filter(Boolean)
        const table = nameOfLink(grtValue(key, "referencedTable"))
        return `- ${grtText(key, "name")}: (${own.join(", ")}) references ${table}(${referenced.join(", ")})`
      })
      if (keys.length > 0) {
        body.push("Foreign keys:", ...keys)
      }
      const indexes = grtObjects(grtValue(object, "indices")).map((index) => {
        const columns = grtObjects(grtValue(index, "columns"))
          .map((column) => nameOfLink(grtValue(column, "referencedColumn")))
          .filter(Boolean)
        const type = grtText(index, "indexType")
        return `- ${grtText(index, "name")}${type ? ` ${type}` : ""}: ${columns.join(", ")}`
      })
      if (indexes.length > 0) {
        body.push("Indexes:", ...indexes)
      }
    } else {
      const definition = textContent(grtValue(object, "sqlDefinition"))
      if (definition) {
        body.push(`Definition: ${definition}`)
      }
    }
    sections.push({ label: `${kind} ${name}`, text: lines(...body) })
  }
  return sections
}

// Oracle SQL Developer Data Modeler: one XML file per object under the design folder.

function oracleDataModelerSections(document: XmlElement): StructuredSection[] {
  const root = documentElement(document)
  if (!root) {
    return []
  }
  const kind = humanize(
    (attribute(root, "class").split(".").pop() ?? localName(root.name)).replace(/Impl$/u, ""),
  )
  const name = attribute(root, "name") || childText(root, "name")
  const comment = childText(root, "comment") || childText(root, "commentInRDBMS")
  const members: string[] = []
  for (const element of descendants(root)) {
    const memberName = attribute(element, "name")
    if (!memberName || element === root || !attribute(element, "id")) {
      continue
    }
    const memberKind = humanize(localName(element.name))
    const details = [
      property(
        "type",
        childText(element, "logicalDatatype") || childText(element, "dataType") || "",
      ),
      property("size", childText(element, "dataTypeSize")),
      childText(element, "nullsAllowed") === "false" ? "not null" : "",
      property("comment", childText(element, "comment") || childText(element, "commentInRDBMS")),
    ].filter(Boolean)
    members.push(
      `- ${memberKind} ${memberName}${details.length > 0 ? `: ${details.join("; ")}` : ""}`,
    )
  }
  return [
    {
      label: `${kind} ${name || "design"}`,
      text: lines(
        `${kind}: ${name}`,
        property("Comment", comment),
        members.length > 0 ? "Members:" : "",
        ...members,
      ),
    },
  ]
}

// draw.io: pages of mxGraphModel, inline or deflate-compressed.

function drawioSections(document: XmlElement): StructuredSection[] {
  const root = documentElement(document)
  if (!root) {
    return []
  }
  const pages: Array<{ name: string; model: XmlElement | undefined }> = []
  if (localName(root.name) === "mxGraphModel") {
    pages.push({ name: "Page 1", model: root })
  } else {
    for (const [index, diagram] of childElements(root, "diagram").entries()) {
      const name = attribute(diagram, "name") || `Page ${index + 1}`
      const inline = firstChild(diagram, "mxGraphModel")
      pages.push({ name, model: inline ?? inflateDrawioDiagram(textContent(diagram)) })
    }
  }
  return pages.flatMap((page) =>
    page.model ? [{ label: `Page ${page.name}`, text: drawioPageText(page.name, page.model) }] : [],
  )
}

/** Base64, raw DEFLATE, then URL encoding: the compressed form draw.io saves by default. */
function inflateDrawioDiagram(content: string): XmlElement | undefined {
  const encoded = content.replace(/\s+/gu, "")
  if (!encoded) {
    return undefined
  }
  const inflated = inflateRawSync(Buffer.from(encoded, "base64"), {
    maxOutputLength: MAX_DIAGRAM_INFLATED_BYTES,
  }).toString("utf8")
  let xml = inflated
  try {
    xml = decodeURIComponent(inflated)
  } catch {
    // Older files store the inflated XML without URL encoding.
  }
  const model = documentElement(parseXmlTree(xml))
  if (!model || localName(model.name) !== "mxGraphModel") {
    throw new Error("Compressed draw.io page does not contain a diagram model.")
  }
  return model
}

interface DrawioCell {
  id: string
  label: string
  parent: string
  source: string
  target: string
  edge: boolean
  properties: string[]
}

const DRAWIO_RESERVED_ATTRIBUTES = new Set(["id", "label", "placeholders", "tooltip", "link"])

function drawioPageText(name: string, model: XmlElement): string {
  const cells: DrawioCell[] = []
  // An mxCell inside <object> or <UserObject> is described by its wrapper.
  const wrapped = new Set<XmlElement>()
  for (const element of descendants(model)) {
    if (localName(element.name) === "object" || localName(element.name) === "UserObject") {
      for (const cell of childElements(element, "mxCell")) {
        wrapped.add(cell)
      }
    }
  }
  for (const element of descendants(model)) {
    const kind = localName(element.name)
    if (kind === "object" || kind === "UserObject") {
      const cell = firstChild(element, "mxCell")
      const properties = Object.entries(element.attributes)
        .filter(([key, value]) => !DRAWIO_RESERVED_ATTRIBUTES.has(key) && value.trim())
        .map(([key, value]) => `${key}: ${htmlLabel(value)}`)
      const tooltip = attribute(element, "tooltip")
      if (tooltip) {
        properties.push(`note: ${htmlLabel(tooltip)}`)
      }
      cells.push({
        id: attribute(element, "id"),
        label: htmlLabel(attribute(element, "label")),
        parent: cell ? attribute(cell, "parent") : "",
        source: cell ? attribute(cell, "source") : "",
        target: cell ? attribute(cell, "target") : "",
        edge: cell ? attribute(cell, "edge") === "1" : false,
        properties,
      })
    } else if (kind === "mxCell") {
      if (attribute(element, "id") && !wrapped.has(element)) {
        cells.push({
          id: attribute(element, "id"),
          label: htmlLabel(attribute(element, "value")),
          parent: attribute(element, "parent"),
          source: attribute(element, "source"),
          target: attribute(element, "target"),
          edge: attribute(element, "edge") === "1",
          properties: [],
        })
      }
    }
  }
  const byId = new Map(cells.map((cell) => [cell.id, cell]))
  const edgeLabels = new Map<string, string[]>()
  for (const cell of cells) {
    const parent = byId.get(cell.parent)
    if (parent?.edge && cell.label) {
      edgeLabels.set(parent.id, [...(edgeLabels.get(parent.id) ?? []), cell.label])
    }
  }
  const shapes = cells
    .filter(
      (cell) =>
        !cell.edge && !byId.get(cell.parent)?.edge && (cell.label || cell.properties.length > 0),
    )
    .map((cell) => {
      const container = byId.get(cell.parent)
      const scope = container?.label && !container.edge ? ` [in ${container.label}]` : ""
      const details = cell.properties.length > 0 ? ` (${cell.properties.join("; ")})` : ""
      return `- ${cell.label || "(unlabelled)"}${scope}${details}`
    })
  const nameOfCell = (id: string) => byId.get(id)?.label || (id ? `shape ${id}` : "?")
  const connections = cells
    .filter((cell) => cell.edge)
    .map((cell) => {
      const label = [cell.label, ...(edgeLabels.get(cell.id) ?? [])].filter(Boolean).join(" ")
      return `- ${nameOfCell(cell.source)} -> ${nameOfCell(cell.target)}${label ? `: ${label}` : ""}`
    })
  return lines(
    `Page: ${name}`,
    shapes.length > 0 ? "Shapes:" : "",
    ...shapes,
    connections.length > 0 ? "Connections:" : "",
    ...connections,
  )
}

/** draw.io editable SVG keeps the whole file in the root `content` attribute. */
export function drawioFromSvg(svg: string): StructuredSection[] | null {
  const root = documentElement(parseXmlTree(svg.slice(0, Math.min(svg.length, 50_000_000))))
  const content = root ? attribute(root, "content") : ""
  if (!content || !/^\s*<mxfile\b/u.test(content)) {
    return null
  }
  return drawioSections(parseXmlTree(content))
}

// BPMN 2.0 process models.

const BPMN_FLOW_NODE =
  /(?:Task|^task|^subProcess|^callActivity|^transaction|Event$|Gateway$|^dataObjectReference|^dataStoreReference)$/u

function bpmnSections(document: XmlElement): StructuredSection[] {
  const byId = new Map<string, XmlElement>()
  for (const element of descendants(document)) {
    const id = attribute(element, "id")
    if (id) {
      byId.set(id, element)
    }
  }
  const nameOf = (id: string) => {
    const element = byId.get(id)
    return element ? attribute(element, "name") || `${humanize(localName(element.name))} ${id}` : id
  }
  const root = documentElement(document)
  if (!root) {
    return []
  }
  const sections: StructuredSection[] = []
  for (const collaboration of childElements(root, "collaboration")) {
    const participants = childElements(collaboration, "participant").map((participant) => {
      const process = attribute(participant, "processRef")
      return `- ${attribute(participant, "name") || process}${process ? ` (process ${nameOf(process)})` : ""}`
    })
    const messages = childElements(collaboration, "messageFlow").map(
      (flow) =>
        `- ${nameOf(attribute(flow, "sourceRef"))} -> ${nameOf(attribute(flow, "targetRef"))}${attribute(flow, "name") ? `: ${attribute(flow, "name")}` : ""}`,
    )
    const name = attribute(collaboration, "name") || attribute(collaboration, "id")
    sections.push({
      label: `Collaboration ${name}`,
      text: lines(
        `Collaboration: ${name}`,
        participants.length > 0 ? "Participants:" : "",
        ...participants,
        messages.length > 0 ? "Message flows:" : "",
        ...messages,
      ),
    })
  }
  for (const process of childElements(root, "process")) {
    const name = attribute(process, "name") || attribute(process, "id")
    sections.push({ label: `Process ${name}`, text: bpmnProcessText(process, nameOf) })
  }
  return sections
}

function bpmnProcessText(process: XmlElement, nameOf: (id: string) => string): string {
  const name = attribute(process, "name") || attribute(process, "id")
  const body = [`Process: ${name}`, property("Documentation", childText(process, "documentation"))]
  const lanes = descendants(process, "lane").map((lane) => {
    const members = childElements(lane, "flowNodeRef").map((reference) =>
      nameOf(textContent(reference)),
    )
    return `- ${attribute(lane, "name")}: ${members.join(", ")}`
  })
  if (lanes.length > 0) {
    body.push("Lanes:", ...lanes)
  }
  const nodes = descendants(process).filter((element) =>
    BPMN_FLOW_NODE.test(localName(element.name)),
  )
  if (nodes.length > 0) {
    body.push(
      "Steps:",
      ...nodes.map((node) => {
        const documentation = childText(node, "documentation")
        const label = attribute(node, "name") || attribute(node, "id")
        return `- ${humanize(localName(node.name))}: ${label}${documentation ? ` (${documentation})` : ""}`
      }),
    )
  }
  const flows = descendants(process, "sequenceFlow").map((flow) => {
    const condition = childText(flow, "conditionExpression")
    const label = [attribute(flow, "name"), condition ? `when ${condition}` : ""]
      .filter(Boolean)
      .join(" ")
    return `- ${nameOf(attribute(flow, "sourceRef"))} -> ${nameOf(attribute(flow, "targetRef"))}${label ? `: ${label}` : ""}`
  })
  if (flows.length > 0) {
    body.push("Flows:", ...flows)
  }
  const notes = descendants(process, "textAnnotation")
    .map((note) => childText(note, "text"))
    .filter(Boolean)
  if (notes.length > 0) {
    body.push("Notes:", ...notes.map((note) => `- ${note}`))
  }
  return lines(...body)
}

// DMN decision models.

function dmnSections(document: XmlElement): StructuredSection[] {
  const root = documentElement(document)
  if (!root) {
    return []
  }
  const byId = new Map<string, XmlElement>()
  for (const element of descendants(root)) {
    const id = attribute(element, "id")
    if (id) {
      byId.set(id, element)
    }
  }
  const nameOfHref = (href: string) => {
    const element = byId.get(href.replace(/^.*#/u, ""))
    return element ? attribute(element, "name") || href : href
  }
  const sections: StructuredSection[] = []
  for (const element of childElements(root)) {
    const kind = localName(element.name)
    if (!["decision", "inputData", "businessKnowledgeModel", "knowledgeSource"].includes(kind)) {
      continue
    }
    const name = attribute(element, "name") || attribute(element, "id")
    const body = [
      `${humanize(kind)}: ${name}`,
      property("Question", childText(element, "question")),
      property("Description", childText(element, "description")),
    ]
    const requirements = [
      ...descendants(element, "requiredDecision"),
      ...descendants(element, "requiredInput"),
      ...descendants(element, "requiredKnowledge"),
    ].map((requirement) => nameOfHref(attribute(requirement, "href")))
    if (requirements.length > 0) {
      body.push(`Requires: ${requirements.join(", ")}`)
    }
    for (const table of descendants(element, "decisionTable")) {
      const inputs = childElements(table, "input").map(
        (input) =>
          attribute(input, "label") ||
          childText(firstChild(input, "inputExpression") ?? input, "text"),
      )
      const outputs = childElements(table, "output").map(
        (output) => attribute(output, "label") || attribute(output, "name"),
      )
      body.push(
        property("Hit policy", attribute(table, "hitPolicy")),
        `Inputs: ${inputs.join(" | ")}`,
        `Outputs: ${outputs.join(" | ")}`,
      )
      for (const [index, rule] of childElements(table, "rule").entries()) {
        const when = childElements(rule, "inputEntry").map(
          (entry) => childText(entry, "text") || "-",
        )
        const then = childElements(rule, "outputEntry").map(
          (entry) => childText(entry, "text") || "-",
        )
        const description = childText(rule, "description")
        body.push(
          `Rule ${index + 1}: ${when.join(" | ")} => ${then.join(" | ")}${description ? ` (${description})` : ""}`,
        )
      }
    }
    for (const literal of descendants(element, "literalExpression")) {
      body.push(property("Expression", childText(literal, "text")))
    }
    sections.push({ label: `${humanize(kind)} ${name}`, text: lines(...body) })
  }
  return sections
}

// ArchiMate: Archi tool models and the Open Group exchange format.

function archimateSections(document: XmlElement): StructuredSection[] {
  const root = documentElement(document)
  if (!root) {
    return []
  }
  interface ArchimateElement {
    id: string
    type: string
    name: string
    documentation: string
    properties: string[]
  }
  interface ArchimateRelation {
    type: string
    name: string
    source: string
    target: string
  }
  const elements = new Map<string, ArchimateElement>()
  const relations: ArchimateRelation[] = []
  const propertyNames = new Map<string, string>()
  for (const definition of descendants(root, "propertyDefinition")) {
    propertyNames.set(attribute(definition, "identifier"), childText(definition, "name"))
  }
  for (const element of descendants(root)) {
    const kind = localName(element.name)
    if (kind !== "element" && kind !== "relationship") {
      continue
    }
    const type = attribute(element, "type").replace(/^archimate:/u, "")
    if (!type || /DiagramModel|^Diagram$/u.test(type)) {
      continue
    }
    const id = attribute(element, "id") || attribute(element, "identifier")
    const name = attribute(element, "name") || childText(element, "name")
    const source = attribute(element, "source")
    const target = attribute(element, "target")
    if (source && target) {
      relations.push({ type: type.replace(/Relationship$/u, ""), name, source, target })
      continue
    }
    const properties = descendants(element, "property")
      .map((entry) => {
        const key =
          attribute(entry, "key") ||
          propertyNames.get(attribute(entry, "propertyDefinitionRef")) ||
          ""
        const value = attribute(entry, "value") || childText(entry, "value")
        return key && value ? `${key}: ${value}` : ""
      })
      .filter(Boolean)
    elements.set(id, {
      id,
      type,
      name,
      documentation: attribute(element, "documentation") || childText(element, "documentation"),
      properties,
    })
  }
  const nameOf = (id: string) => elements.get(id)?.name || id
  return [...elements.values()].map((element) => {
    const outgoing = relations
      .filter((relation) => relation.source === element.id)
      .map(
        (relation) =>
          `- ${humanize(relation.type)} -> ${nameOf(relation.target)}${relation.name ? ` (${relation.name})` : ""}`,
      )
    const incoming = relations
      .filter((relation) => relation.target === element.id)
      .map(
        (relation) =>
          `- ${humanize(relation.type)} <- ${nameOf(relation.source)}${relation.name ? ` (${relation.name})` : ""}`,
      )
    const kind = humanize(element.type)
    return {
      label: `${kind} ${element.name || element.id}`,
      text: lines(
        `${kind}: ${element.name}`,
        property("Documentation", element.documentation),
        ...element.properties,
        outgoing.length + incoming.length > 0 ? "Relations:" : "",
        ...outgoing,
        ...incoming,
      ),
    }
  })
}

// UML models in XMI (Enterprise Architect, Papyrus, Modelio, MagicDraw exports).

const XMI_CLASSIFIERS = new Set([
  "Class",
  "Interface",
  "Enumeration",
  "DataType",
  "Component",
  "Actor",
  "UseCase",
  "Activity",
  "StateMachine",
  "Signal",
  "Node",
  "Artifact",
  "Association",
])

function xmiSections(document: XmlElement): StructuredSection[] {
  const byId = new Map<string, XmlElement>()
  const documentation = new Map<string, string>()
  for (const element of descendants(document)) {
    const id = attribute(element, "id")
    if (id) {
      byId.set(id, element)
    }
    // Enterprise Architect keeps notes in its extension block, keyed by the element id.
    const reference = attribute(element, "idref")
    if (reference && localName(element.name) === "element") {
      const notes = firstChild(element, "properties")
      const text = notes ? attribute(notes, "documentation") : ""
      if (text) {
        documentation.set(reference, htmlLabel(text))
      }
    }
  }
  const typeName = (element: XmlElement) => {
    const reference = attribute(element, "type")
    const target = reference ? byId.get(reference) : undefined
    if (target) {
      return attribute(target, "name")
    }
    const href = attribute(firstChild(element, "type") ?? element, "href")
    return href ? (href.split("#").pop() ?? "") : reference
  }
  const kindOf = (element: XmlElement) => {
    const declared = attribute(element, "type")
    if (declared.startsWith("uml:")) {
      return declared.slice(4)
    }
    return element.name.startsWith("UML:") ? element.name.slice(4) : ""
  }
  const sections: StructuredSection[] = []
  for (const element of descendants(document)) {
    const kind = kindOf(element)
    if (!XMI_CLASSIFIERS.has(kind) || !attribute(element, "id")) {
      continue
    }
    const name = attribute(element, "name")
    if (!name && kind !== "Association") {
      continue
    }
    const body = [`${humanize(kind)}: ${name}`]
    const comments = [
      ...descendants(element, "ownedComment").map(
        (comment) => attribute(comment, "body") || childText(comment, "body"),
      ),
      documentation.get(attribute(element, "id")) ?? "",
    ].filter(Boolean)
    body.push(...comments.map((comment) => `Note: ${comment}`))
    const parents = descendants(element, "generalization")
      .map((generalization) => {
        const target = byId.get(attribute(generalization, "general"))
        return target ? attribute(target, "name") : ""
      })
      .filter(Boolean)
    if (parents.length > 0) {
      body.push(`Extends: ${parents.join(", ")}`)
    }
    const attributes = [
      ...childElements(element, "ownedAttribute"),
      ...descendants(element, "Attribute"),
    ].map((owned) => {
      const type = typeName(owned)
      return `- ${attribute(owned, "name") || "(unnamed)"}${type ? `: ${type}` : ""}`
    })
    if (attributes.length > 0) {
      body.push(kind === "Association" ? "Ends:" : "Attributes:", ...attributes)
    }
    const ends = childElements(element, "ownedEnd").map((end) => `- ${typeName(end)}`)
    if (ends.length > 0) {
      body.push("Ends:", ...ends)
    }
    const operations = [
      ...childElements(element, "ownedOperation"),
      ...descendants(element, "Operation"),
    ].map((operation) => {
      const parameters = childElements(operation, "ownedParameter")
        .filter((parameter) => attribute(parameter, "direction") !== "return")
        .map((parameter) => {
          const type = typeName(parameter)
          return `${attribute(parameter, "name")}${type ? `: ${type}` : ""}`
        })
      const returns = childElements(operation, "ownedParameter").find(
        (parameter) => attribute(parameter, "direction") === "return",
      )
      const returnType = returns ? typeName(returns) : ""
      return `- ${attribute(operation, "name")}(${parameters.join(", ")})${returnType ? `: ${returnType}` : ""}`
    })
    if (operations.length > 0) {
      body.push("Operations:", ...operations)
    }
    const literals = childElements(element, "ownedLiteral").map((literal) =>
      attribute(literal, "name"),
    )
    if (literals.length > 0) {
      body.push(`Values: ${literals.join(", ")}`)
    }
    const label = name || attribute(element, "id")
    sections.push({ label: `${humanize(kind)} ${label}`, text: lines(...body) })
  }
  return sections
}

// Tableau workbooks.

function tableauSections(document: XmlElement): StructuredSection[] {
  const root = documentElement(document)
  if (!root) {
    return []
  }
  const sections: StructuredSection[] = []
  for (const source of descendants(firstChild(root, "datasources") ?? root, "datasource")) {
    const name = attribute(source, "caption") || attribute(source, "name")
    if (!name || source === root) {
      continue
    }
    const connection = descendants(source, "connection")[0]
    const columns = childElements(source, "column").map((column) => {
      const calculation = firstChild(column, "calculation")
      const formula = calculation ? attribute(calculation, "formula") : ""
      const details = [
        attribute(column, "datatype"),
        attribute(column, "role"),
        formula ? `formula ${formula}` : "",
        childText(firstChild(column, "desc") ?? column, "formatted-text"),
      ].filter(Boolean)
      return `- ${attribute(column, "caption") || attribute(column, "name").replace(/^\[|\]$/gu, "")}${details.length > 0 ? `: ${details.join("; ")}` : ""}`
    })
    sections.push({
      label: `Data source ${name}`,
      text: lines(
        `Data source: ${name}`,
        connection
          ? property(
              "Connection",
              [attribute(connection, "class"), attribute(connection, "dbname")]
                .filter(Boolean)
                .join(" "),
            )
          : "",
        columns.length > 0 ? "Fields:" : "",
        ...columns,
      ),
    })
  }
  for (const sheet of descendants(firstChild(root, "worksheets") ?? root, "worksheet")) {
    const name = attribute(sheet, "name")
    const view = descendants(sheet, "table")[0]
    sections.push({
      label: `Worksheet ${name}`,
      text: lines(
        `Worksheet: ${name}`,
        property("Title", textContent(firstChild(sheet, "layout-options"))),
        property("Rows", view ? childText(view, "rows") : ""),
        property("Columns", view ? childText(view, "cols") : ""),
        property(
          "Data sources",
          descendants(sheet, "datasource")
            .map((source) => attribute(source, "caption") || attribute(source, "name"))
            .filter(Boolean)
            .join(", "),
        ),
      ),
    })
  }
  for (const dashboard of descendants(firstChild(root, "dashboards") ?? root, "dashboard")) {
    const name = attribute(dashboard, "name")
    const zones = [
      ...new Set(
        descendants(dashboard, "zone")
          .map((zone) => attribute(zone, "name"))
          .filter(Boolean),
      ),
    ]
    sections.push({
      label: `Dashboard ${name}`,
      text: lines(`Dashboard: ${name}`, zones.length > 0 ? `Sheets: ${zones.join(", ")}` : ""),
    })
  }
  return sections
}

// Visio drawings: pages of shapes and connectors inside the .vsdx package.

export function visioSections(entries: Map<string, string>): StructuredSection[] {
  const pagesXml = entries.get("visio/pages/pages.xml")
  const relationships = entries.get("visio/pages/_rels/pages.xml.rels")
  if (!pagesXml) {
    throw new Error("Visio package has no pages.")
  }
  const targets = new Map<string, string>()
  if (relationships) {
    for (const relationship of descendants(parseXmlTree(relationships), "Relationship")) {
      targets.set(attribute(relationship, "Id"), attribute(relationship, "Target"))
    }
  }
  const sections: StructuredSection[] = []
  for (const [index, page] of descendants(parseXmlTree(pagesXml), "Page").entries()) {
    if (attribute(page, "Background") === "1") {
      continue
    }
    const name = attribute(page, "NameU") || attribute(page, "Name") || `Page ${index + 1}`
    const relation = firstChild(page, "Rel")
    const target = relation ? targets.get(attribute(relation, "id")) : undefined
    const xml = target ? entries.get(`visio/pages/${target.replace(/^\.?\//u, "")}`) : undefined
    if (!xml) {
      continue
    }
    const contents = parseXmlTree(xml)
    const shapes = new Map<string, string>()
    for (const shape of descendants(contents, "Shape")) {
      const text = textContent(firstChild(shape, "Text"))
      if (text) {
        shapes.set(attribute(shape, "ID"), text)
      }
    }
    const ends = new Map<string, { begin?: string; end?: string }>()
    for (const connect of descendants(contents, "Connect")) {
      const connector = attribute(connect, "FromSheet")
      const entry = ends.get(connector) ?? {}
      if (/^Begin/u.test(attribute(connect, "FromCell"))) {
        entry.begin = attribute(connect, "ToSheet")
      } else if (/^End/u.test(attribute(connect, "FromCell"))) {
        entry.end = attribute(connect, "ToSheet")
      }
      ends.set(connector, entry)
    }
    const shapeLines = [...shapes].filter(([id]) => !ends.has(id)).map(([, text]) => `- ${text}`)
    const connections = [...ends].map(([connector, entry]) => {
      const label = shapes.get(connector)
      return `- ${shapes.get(entry.begin ?? "") ?? "?"} -> ${shapes.get(entry.end ?? "") ?? "?"}${label ? `: ${label}` : ""}`
    })
    sections.push({
      label: `Page ${name}`,
      text: lines(
        `Page: ${name}`,
        shapeLines.length > 0 ? "Shapes:" : "",
        ...shapeLines,
        connections.length > 0 ? "Connections:" : "",
        ...connections,
      ),
    })
  }
  return sections
}

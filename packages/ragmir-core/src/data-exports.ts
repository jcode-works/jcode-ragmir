import YAML from "yaml"
import { apiDescriptionSections } from "./api-description.js"
import {
  excalidrawSections,
  figmaSections,
  jsonCanvasSections,
  tldrawSections,
} from "./design-formats.js"
import { isRecord } from "./guards.js"
import type { StructuredSection } from "./structured-formats.js"

/**
 * JSON and YAML exports recognised by their shape: API descriptions, Postman and Insomnia
 * collections, design files, GeoJSON features, and SARIF scan results. Each becomes one cited
 * section per object; any other value returns null and keeps its plain-text indexing.
 */
export function jsonExportSections(value: unknown): StructuredSection[] | null {
  return (
    apiDescriptionSections(value) ??
    postmanSections(value) ??
    insomniaSections(value) ??
    figmaSections(value) ??
    excalidrawSections(value) ??
    tldrawSections(value) ??
    geoJsonSections(value) ??
    sarifSections(value) ??
    jsonCanvasSections(value)
  )
}

// Request bodies and example responses can be large; the beginning documents the shape.
const MAX_BODY_CHARACTERS = 20_000
const MAX_LABEL_CHARACTERS = 120
const SENSITIVE_NAME =
  /authorization|cookie|token|secret|password|passwd|api[-_]?key|session|credential/iu

/** Postman collection v2.0 or v2.1: an overview, then one section per request. */
function postmanSections(value: unknown): StructuredSection[] | null {
  if (!isRecord(value) || !isRecord(value.info) || !Array.isArray(value.item)) {
    return null
  }
  const schema = stringOf(value.info.schema)
  if (!/getpostman\.com|postman/iu.test(schema) && typeof value.info._postman_id !== "string") {
    return null
  }
  const name = stringOf(value.info.name) || "Collection"
  const sections: StructuredSection[] = [
    {
      label: `Collection ${name}`,
      text: lines(
        `Collection: ${name}`,
        descriptionText(value.info.description),
        variablesText(value.variable),
        authText(value.auth),
      ),
    },
  ]
  const visit = (items: unknown[], folders: string[], depth: number) => {
    if (depth > 32) {
      return
    }
    for (const item of items.filter(isRecord)) {
      const itemName = stringOf(item.name)
      if (Array.isArray(item.item)) {
        const folder = [...folders, itemName || "Folder"]
        const description = descriptionText(item.description)
        if (description) {
          sections.push({
            label: truncate(`Folder ${folder.join(" / ")}`),
            text: lines(`Folder: ${folder.join(" / ")}`, description),
          })
        }
        visit(item.item, folder, depth + 1)
        continue
      }
      if (item.request === undefined) {
        continue
      }
      sections.push(postmanRequestSection(item, folders))
    }
  }
  visit(value.item, [], 0)
  return sections
}

function postmanRequestSection(
  item: Record<string, unknown>,
  folders: string[],
): StructuredSection {
  const request = isRecord(item.request) ? item.request : { url: item.request }
  const method = (stringOf(request.method) || "GET").toUpperCase()
  const url = isRecord(request.url) ? request.url : { raw: stringOf(request.url) }
  const raw = stringOf(url.raw)
  const title = [...folders, stringOf(item.name) || "Request"].join(" / ")
  const body = isRecord(request.body) ? request.body : {}
  const responses = Array.isArray(item.response) ? item.response.filter(isRecord) : []
  return {
    label: truncate(`${method} ${raw.split("?")[0] || title}`),
    text: lines(
      `Request: ${title}`,
      `${method} ${raw}`,
      descriptionText(request.description),
      keyValueList("Query parameters", url.query),
      keyValueList("Path variables", url.variable),
      keyValueList("Headers", request.header, "name"),
      authText(request.auth),
      postmanBodyText(body),
      ...responses.map(
        (response) =>
          `Example response: ${stringOf(response.name) || "response"}${
            typeof response.code === "number" ? ` (${response.code})` : ""
          }\n${bounded(stringOf(response.body))}`,
      ),
    ),
  }
}

function postmanBodyText(body: Record<string, unknown>): string {
  switch (body.mode) {
    case "raw":
      return stringOf(body.raw) ? `Body:\n${bounded(stringOf(body.raw))}` : ""
    case "urlencoded":
    case "formdata":
      return keyValueList("Body fields", body[body.mode])
    case "graphql": {
      const graphql = isRecord(body.graphql) ? body.graphql : {}
      return lines(
        stringOf(graphql.query) && `GraphQL query:\n${bounded(stringOf(graphql.query))}`,
        stringOf(graphql.variables) && `Variables:\n${bounded(stringOf(graphql.variables))}`,
      )
    }
    default:
      return ""
  }
}

/** Insomnia export: v4 JSON resources or the v5 YAML collection tree. */
function insomniaSections(value: unknown): StructuredSection[] | null {
  if (!isRecord(value)) {
    return null
  }
  if (value._type === "export" && Array.isArray(value.resources)) {
    const resources = value.resources.filter(isRecord)
    const byId = new Map(resources.map((resource) => [stringOf(resource._id), resource]))
    const folderPath = (resource: Record<string, unknown>): string[] => {
      const path: string[] = []
      let parent = byId.get(stringOf(resource.parentId))
      for (let depth = 0; parent && depth < 32; depth += 1) {
        if (parent._type === "request_group") {
          path.unshift(stringOf(parent.name) || "Folder")
        }
        parent = byId.get(stringOf(parent.parentId))
      }
      return path
    }
    const sections: StructuredSection[] = []
    for (const resource of resources) {
      if (resource._type === "workspace") {
        sections.push({
          label: `Collection ${stringOf(resource.name) || "Workspace"}`,
          text: lines(
            `Collection: ${stringOf(resource.name)}`,
            descriptionText(resource.description),
          ),
        })
      } else if (resource._type === "request") {
        sections.push(insomniaRequestSection(resource, folderPath(resource)))
      }
    }
    return sections
  }
  if (typeof value.type === "string" && /^collection\.insomnia\.rest\//u.test(value.type)) {
    const name = stringOf(value.name) || "Collection"
    const sections: StructuredSection[] = [
      { label: `Collection ${name}`, text: `Collection: ${name}` },
    ]
    const visit = (items: unknown, folders: string[], depth: number) => {
      if (!Array.isArray(items) || depth > 32) {
        return
      }
      for (const item of items.filter(isRecord)) {
        if (Array.isArray(item.children)) {
          visit(item.children, [...folders, stringOf(item.name) || "Folder"], depth + 1)
        } else if (typeof item.url === "string") {
          sections.push(insomniaRequestSection(item, folders))
        }
      }
    }
    visit(value.collection, [], 0)
    return sections
  }
  return null
}

function insomniaRequestSection(
  request: Record<string, unknown>,
  folders: string[],
): StructuredSection {
  const method = (stringOf(request.method) || "GET").toUpperCase()
  const url = stringOf(request.url)
  const title = [...folders, stringOf(request.name) || "Request"].join(" / ")
  const meta = isRecord(request.meta) ? request.meta : {}
  const body = isRecord(request.body) ? request.body : {}
  return {
    label: truncate(`${method} ${url.split("?")[0] || title}`),
    text: lines(
      `Request: ${title}`,
      `${method} ${url}`,
      descriptionText(request.description ?? meta.description),
      keyValueList("Query parameters", request.parameters, "name"),
      keyValueList("Headers", request.headers, "name"),
      authText(request.authentication),
      stringOf(body.text) && `Body:\n${bounded(stringOf(body.text))}`,
    ),
  }
}

/** GeoJSON: one section per feature with its properties; coordinates only for points. */
function geoJsonSections(value: unknown): StructuredSection[] | null {
  if (!isRecord(value)) {
    return null
  }
  const features =
    value.type === "FeatureCollection" && Array.isArray(value.features)
      ? value.features.filter(isRecord)
      : value.type === "Feature"
        ? [value]
        : null
  if (!features) {
    return null
  }
  return features.map((feature, index) => {
    const properties = isRecord(feature.properties) ? feature.properties : {}
    const name =
      ["name", "title", "label", "NAME", "Name"]
        .map((key) => stringOf(properties[key]))
        .find(Boolean) ||
      (feature.id === undefined ? "" : String(feature.id)) ||
      `Feature ${index + 1}`
    const geometry = isRecord(feature.geometry) ? feature.geometry : {}
    const coordinates =
      geometry.type === "Point" && Array.isArray(geometry.coordinates)
        ? ` (${geometry.coordinates.join(", ")})`
        : ""
    return {
      label: truncate(`Feature ${name}`),
      text: lines(
        `Feature: ${name}`,
        stringOf(geometry.type) && `Geometry: ${stringOf(geometry.type)}${coordinates}`,
        ...Object.entries(properties).map(([key, item]) => `${key}: ${scalarText(item)}`),
      ),
    }
  })
}

/** SARIF 2.x static-analysis log: one section per result with its rule and location. */
function sarifSections(value: unknown): StructuredSection[] | null {
  if (!isRecord(value) || !Array.isArray(value.runs) || !/^2\./u.test(stringOf(value.version))) {
    return null
  }
  const sections: StructuredSection[] = []
  for (const run of value.runs.filter(isRecord)) {
    const tool = isRecord(run.tool) && isRecord(run.tool.driver) ? run.tool.driver : {}
    const toolName = stringOf(tool.name) || "Analyzer"
    const rules = Array.isArray(tool.rules) ? tool.rules.filter(isRecord) : []
    const ruleById = new Map(rules.map((rule) => [stringOf(rule.id), rule]))
    for (const result of Array.isArray(run.results) ? run.results.filter(isRecord) : []) {
      const rule =
        ruleById.get(stringOf(result.ruleId)) ??
        (typeof result.ruleIndex === "number" ? rules[result.ruleIndex] : undefined) ??
        {}
      const ruleId = stringOf(result.ruleId) || stringOf(rule.id) || "result"
      const locations = (Array.isArray(result.locations) ? result.locations : [])
        .filter(isRecord)
        .map(sarifLocation)
        .filter(Boolean)
      sections.push({
        label: truncate(`${ruleId} ${locations[0] ?? ""}`.trim()),
        text: lines(
          `Finding: ${ruleId}`,
          `Tool: ${toolName}`,
          stringOf(rule.name) && `Rule: ${stringOf(rule.name)}`,
          `Level: ${stringOf(result.level) || "warning"}`,
          messageText(result.message) && `Message: ${messageText(result.message)}`,
          locations.length > 0 && `Locations: ${locations.join(", ")}`,
          messageText(rule.shortDescription),
          messageText(rule.fullDescription),
          messageText(rule.help),
        ),
      })
    }
  }
  return sections
}

function sarifLocation(location: Record<string, unknown>): string {
  const physical = isRecord(location.physicalLocation) ? location.physicalLocation : {}
  const artifact = isRecord(physical.artifactLocation) ? physical.artifactLocation : {}
  const region = isRecord(physical.region) ? physical.region : {}
  const uri = stringOf(artifact.uri)
  const line = typeof region.startLine === "number" ? `:${region.startLine}` : ""
  return uri ? `${uri}${line}` : ""
}

function messageText(value: unknown): string {
  return isRecord(value) ? stringOf(value.text) || stringOf(value.markdown) : ""
}

function descriptionText(value: unknown): string {
  const text = isRecord(value) ? stringOf(value.content) : stringOf(value)
  return text ? `Description: ${text}` : ""
}

function variablesText(value: unknown): string {
  return keyValueList("Variables", value)
}

function authText(value: unknown): string {
  return isRecord(value) && stringOf(value.type) ? `Auth: ${stringOf(value.type)}` : ""
}

/** `- key: value (description)`, with the values of secret-like names left out. */
function keyValueList(title: string, value: unknown, keyField = "key"): string {
  if (!Array.isArray(value)) {
    return ""
  }
  const entries = value.filter(isRecord).flatMap((entry) => {
    if (entry.disabled === true) {
      return []
    }
    const key = stringOf(entry[keyField]) || stringOf(entry.key) || stringOf(entry.name)
    if (!key) {
      return []
    }
    const raw = scalarText(entry.value)
    const shown = SENSITIVE_NAME.test(key) ? (raw ? "(value omitted)" : "") : raw
    const description = descriptionText(entry.description).replace(/^Description: /u, "")
    return [`- ${key}${shown ? `: ${shown}` : ""}${description ? ` (${description})` : ""}`]
  })
  return entries.length > 0 ? `${title}:\n${entries.join("\n")}` : ""
}

function scalarText(value: unknown): string {
  if (value === null || value === undefined) {
    return ""
  }
  if (typeof value === "string") {
    return value.trim()
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  return bounded(YAML.stringify(value).trim())
}

function bounded(text: string): string {
  return text.length > MAX_BODY_CHARACTERS
    ? `${text.slice(0, MAX_BODY_CHARACTERS)}\n[${text.length - MAX_BODY_CHARACTERS} more characters]`
    : text
}

function truncate(label: string): string {
  const single = label.replace(/\s+/gu, " ").trim()
  return single.length > MAX_LABEL_CHARACTERS
    ? `${single.slice(0, MAX_LABEL_CHARACTERS - 1).trimEnd()}…`
    : single
}

function lines(...values: Array<string | false | null | undefined>): string {
  return values.filter((value): value is string => Boolean(value)).join("\n")
}

function stringOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

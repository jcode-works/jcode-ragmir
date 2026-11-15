import YAML from "yaml"
import { isRecord } from "./guards.js"
import type { StructuredSection } from "./structured-formats.js"

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"]

/**
 * Split an OpenAPI, Swagger, or AsyncAPI description into one section per operation, channel, and
 * schema, so a search cites `GET /users` instead of a line range of a large document.
 * Returns null for any other JSON or YAML value.
 */
export function apiDescriptionSections(value: unknown): StructuredSection[] | null {
  if (!isRecord(value)) {
    return null
  }
  if (
    (typeof value.openapi === "string" || typeof value.swagger === "string") &&
    isRecord(value.paths)
  ) {
    return openApiSections(value, value.paths)
  }
  if (
    typeof value.asyncapi === "string" &&
    (isRecord(value.channels) || isRecord(value.operations))
  ) {
    return asyncApiSections(value)
  }
  return null
}

function openApiSections(
  document: Record<string, unknown>,
  paths: Record<string, unknown>,
): StructuredSection[] {
  const sections = [overviewSection(document, "API")]
  for (const [route, pathItem] of Object.entries(paths)) {
    if (!isRecord(pathItem)) {
      continue
    }
    const shared = Array.isArray(pathItem.parameters) ? pathItem.parameters : []
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method]
      if (!isRecord(operation)) {
        continue
      }
      const label = `${method.toUpperCase()} ${route}`
      const merged =
        shared.length > 0
          ? {
              ...operation,
              parameters: [
                ...shared,
                ...(Array.isArray(operation.parameters) ? operation.parameters : []),
              ],
            }
          : operation
      sections.push({ label, text: `Operation: ${label}\n${YAML.stringify(merged)}` })
    }
  }
  const components = isRecord(document.components) ? document.components : {}
  const schemas = isRecord(components.schemas)
    ? components.schemas
    : isRecord(document.definitions)
      ? document.definitions
      : {}
  sections.push(...namedSections("Schema", schemas))
  return sections
}

function asyncApiSections(document: Record<string, unknown>): StructuredSection[] {
  const sections = [overviewSection(document, "AsyncAPI")]
  sections.push(...namedSections("Channel", isRecord(document.channels) ? document.channels : {}))
  sections.push(
    ...namedSections("Operation", isRecord(document.operations) ? document.operations : {}),
  )
  const components = isRecord(document.components) ? document.components : {}
  sections.push(
    ...namedSections("Message", isRecord(components.messages) ? components.messages : {}),
  )
  sections.push(...namedSections("Schema", isRecord(components.schemas) ? components.schemas : {}))
  return sections
}

function overviewSection(document: Record<string, unknown>, kind: string): StructuredSection {
  const info = isRecord(document.info) ? document.info : {}
  const title = typeof info.title === "string" ? info.title : kind
  const overview: Record<string, unknown> = { info }
  for (const key of ["servers", "host", "basePath", "tags", "security", "externalDocs"]) {
    if (document[key] !== undefined) {
      overview[key] = document[key]
    }
  }
  return { label: `${kind} ${title}`, text: `${kind}: ${title}\n${YAML.stringify(overview)}` }
}

function namedSections(kind: string, entries: Record<string, unknown>): StructuredSection[] {
  return Object.entries(entries).map(([name, value]) => ({
    label: `${kind} ${name}`,
    text: `${kind}: ${name}\n${YAML.stringify(value)}`,
  }))
}

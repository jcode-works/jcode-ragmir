import { isRecord } from "./guards.js"
import type { HtmlRenderer } from "./mail.js"
import { throwIfAborted } from "./operation.js"
import type { StructuredSection } from "./structured-formats.js"

// A HAR file records a live browser or proxy session, so it routinely holds credentials. Values
// whose name or shape marks a secret are left out, and cookies are never read.
const SECRET_NAME =
  /authorization|cookie|token|secret|passw(?:or)?d|passphrase|api[-_]?key|apikey|session|credential|signature|csrf|xsrf|jwt|private[-_]?key|access[-_]?key|(?:^|[-_.])otp(?:$|[-_.])/iu
// Query parameters add OAuth and signed-URL names that are harmless as JSON keys.
const SECRET_QUERY_NAME = /^(?:code|state|nonce|key|sig|x-amz-credential)$/iu
const SECRET_VALUE = /^(?:bearer|basic|digest)\s+\S|^eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*$/iu
const SECRET_IN_TEXT = [
  /\b(bearer|basic|digest)\s+[\w.~+/=-]{8,}/giu,
  /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]+/gu,
] as const
const OMITTED = "(value omitted)"
const MAX_BODY_CHARACTERS = 20_000
const MAX_LABEL_CHARACTERS = 120
const MAX_JSON_DEPTH = 64
// Static assets and CORS preflights carry no project knowledge and would bury the API calls.
const SKIPPED_RESOURCE_TYPES = new Set([
  "csp_violation_report",
  "font",
  "image",
  "manifest",
  "media",
  "ping",
  "preflight",
  "prefetch",
  "script",
  "signed_exchange",
  "stylesheet",
  "texttrack",
])
const ASSET_MIME = /^(?:image|font|audio|video)\/|^text\/css|javascript|ecmascript|wasm/iu
const TEXT_MIME = /^text\/|json|xml|graphql|yaml|csv|x-www-form-urlencoded/iu

interface Pair {
  name: string
  value: string
}

/**
 * HTTP Archive (HAR 1.2) from browser DevTools, Charles, Proxyman, or Fiddler: an overview, then
 * one section per API or page request with its method, URL, status, headers, and text bodies.
 * Cookies, credentials, and secret-like parameters are left out, static assets are skipped, and
 * identical repeated requests are indexed once with their count.
 */
export function harSections(
  value: unknown,
  renderHtml: HtmlRenderer,
  signal?: AbortSignal,
): StructuredSection[] | null {
  if (!isRecord(value) || !isRecord(value.log) || !Array.isArray(value.log.entries)) {
    return null
  }
  const log = value.log
  const entries = value.log.entries.filter(isRecord)
  const pages = new Map<string, string>()
  for (const page of Array.isArray(log.pages) ? log.pages.filter(isRecord) : []) {
    const id = stringOf(page.id)
    const title = stringOf(page.title)
    if (id && title) {
      pages.set(id, redactedTitle(title))
    }
  }

  const requests = new Map<string, { section: StructuredSection; count: number }>()
  const labelCounts = new Map<string, number>()
  for (const entry of entries) {
    throwIfAborted(signal)
    const section = entrySection(entry, pages, renderHtml)
    if (!section) {
      continue
    }
    const known = requests.get(section.text)
    if (known) {
      known.count += 1
      continue
    }
    const labelCount = (labelCounts.get(section.label) ?? 0) + 1
    labelCounts.set(section.label, labelCount)
    const label = labelCount > 1 ? truncate(`${section.label} (${labelCount})`) : section.label
    requests.set(section.text, { section: { ...section, label }, count: 1 })
  }

  const indexed = [...requests.values()].map(({ section, count }) =>
    count > 1 ? { ...section, text: `${section.text}\nRepeated ${count} times` } : section,
  )
  const skipped = entries.length - [...requests.values()].reduce((sum, item) => sum + item.count, 0)
  return [
    {
      label: "HTTP Archive",
      text: lines(
        `HTTP Archive${toolName(log.creator, " recorded with ")}${toolName(log.browser, " in ")}`,
        pages.size > 0 && `Pages:\n${[...pages.values()].map((title) => `- ${title}`).join("\n")}`,
        `Requests: ${entries.length}, ${indexed.length} indexed${
          skipped > 0 ? `, ${skipped} static assets, preflights, or non-HTTP requests skipped` : ""
        }`,
        "Cookies, credentials, and secret-like values are left out.",
      ),
    },
    ...indexed,
  ]
}

function entrySection(
  entry: Record<string, unknown>,
  pages: Map<string, string>,
  renderHtml: HtmlRenderer,
): StructuredSection | null {
  if (!isRecord(entry.request)) {
    return null
  }
  const request = entry.request
  const method = (stringOf(request.method) || "GET").toUpperCase()
  const url = parsedUrl(stringOf(request.url))
  if (!url || method === "OPTIONS") {
    return null
  }
  const response = isRecord(entry.response) ? entry.response : {}
  const content = isRecord(response.content) ? response.content : {}
  const mimeType = mimeOf(content.mimeType)
  const resourceType = stringOf(entry._resourceType).toLowerCase()
  if (SKIPPED_RESOURCE_TYPES.has(resourceType) || (!resourceType && ASSET_MIME.test(mimeType))) {
    return null
  }

  const address = `${url.origin}${url.pathname}`
  const statusCode = typeof response.status === "number" ? response.status : 0
  const status =
    statusCode > 0
      ? `Status: ${statusCode}${stringOf(response.statusText) ? ` ${stringOf(response.statusText)}` : ""}`
      : ""
  const page = pages.get(stringOf(entry.pageref))
  return {
    label: truncate(`${method} ${address}`),
    text: lines(
      `Request: ${method} ${address}`,
      page && `Page: ${page}`,
      status,
      pairList(
        "Query parameters",
        [...url.searchParams].map(([name, value]) => ({ name, value })),
        true,
      ),
      pairList("Request headers", pairsOf(request.headers)),
      isRecord(request.postData) && requestBody(request.postData),
      pairList("Response headers", pairsOf(response.headers)),
      responseBody(content, mimeType, renderHtml),
    ),
  }
}

function requestBody(postData: Record<string, unknown>): string {
  const mimeType = mimeOf(postData.mimeType)
  if (Array.isArray(postData.params) && postData.params.length > 0) {
    const fields = postData.params.filter(isRecord).map((param) => ({
      name: stringOf(param.name),
      value: stringOf(param.fileName) ? `file ${stringOf(param.fileName)}` : rawString(param.value),
    }))
    return pairList("Request body fields", fields)
  }
  const text = rawString(postData.text)
  if (!text.trim()) {
    return ""
  }
  if (mimeType.includes("multipart/")) {
    return `Request body: ${mimeType}, not indexed`
  }
  return `Request body${mimeType ? ` (${mimeType})` : ""}:\n${bounded(redactedText(text, mimeType))}`
}

function responseBody(
  content: Record<string, unknown>,
  mimeType: string,
  renderHtml: HtmlRenderer,
): string {
  if (!TEXT_MIME.test(mimeType)) {
    return ""
  }
  // Charles and Proxyman save text bodies in base64 as well; binary bodies never reach here.
  const raw = rawString(content.text)
  const text =
    stringOf(content.encoding) === "base64" ? Buffer.from(raw, "base64").toString("utf8") : raw
  if (!text.trim()) {
    return ""
  }
  const body = mimeType.includes("html") ? scrubbed(renderHtml(text)) : redactedText(text, mimeType)
  return body.trim() ? `Response body (${mimeType}):\n${bounded(body.trim())}` : ""
}

/** JSON keeps its shape with secret fields left out; form bodies list their fields. */
function redactedText(text: string, mimeType: string): string {
  const trimmed = text.trim()
  if (mimeType.includes("json") || /^[[{]/u.test(trimmed)) {
    try {
      return JSON.stringify(redactedJson(JSON.parse(trimmed), 0), null, 2)
    } catch {
      // Not JSON after all: fall through to the plain-text scrub.
    }
  }
  if (mimeType.includes("x-www-form-urlencoded")) {
    return [...new URLSearchParams(trimmed)]
      .map(([name, value]) => `${name}=${isSecret(name, value, false) ? OMITTED : value}`)
      .join("\n")
  }
  return scrubbed(text)
}

function redactedJson(value: unknown, depth: number): unknown {
  if (depth > MAX_JSON_DEPTH) {
    return null
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactedJson(item, depth + 1))
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SECRET_NAME.test(key) ? OMITTED : redactedJson(item, depth + 1),
      ]),
    )
  }
  return typeof value === "string" && SECRET_VALUE.test(value.trim()) ? OMITTED : value
}

/** `- name: value` lines; pseudo-headers and browser fetch metadata are left out as noise. */
function pairList(title: string, pairs: Pair[], query = false): string {
  const shown = pairs
    .filter((pair) => pair.name && !pair.name.startsWith(":") && !/^sec-/iu.test(pair.name))
    .map((pair) => {
      const value = isSecret(pair.name, pair.value, query) ? OMITTED : scrubbed(pair.value.trim())
      return `- ${pair.name}${value ? `: ${value}` : ""}`
    })
  return shown.length > 0 ? `${title}:\n${shown.join("\n")}` : ""
}

function pairsOf(value: unknown): Pair[] {
  return Array.isArray(value)
    ? value
        .filter(isRecord)
        .map((pair) => ({ name: stringOf(pair.name), value: rawString(pair.value) }))
    : []
}

function isSecret(name: string, value: string, query: boolean): boolean {
  return (
    SECRET_NAME.test(name) ||
    (query && SECRET_QUERY_NAME.test(name)) ||
    SECRET_VALUE.test(value.trim())
  )
}

function scrubbed(text: string): string {
  return SECRET_IN_TEXT.reduce(
    (current, pattern) =>
      current.replace(pattern, (match, scheme?: string) =>
        typeof scheme === "string" && match.toLowerCase().startsWith(scheme.toLowerCase())
          ? `${scheme} ${OMITTED}`
          : OMITTED,
      ),
    text,
  )
}

/** HTTP and WebSocket requests only; credentials and fragments in the URL are dropped. */
function parsedUrl(raw: string): URL | null {
  try {
    const url = new URL(raw)
    if (!/^(?:https?|wss?):$/u.test(url.protocol)) {
      return null
    }
    url.username = ""
    url.password = ""
    url.hash = ""
    return url
  } catch {
    return null
  }
}

/** Page titles are often the page URL: keep its address and drop the query and fragment. */
function redactedTitle(title: string): string {
  const url = parsedUrl(title)
  return url ? `${url.origin}${url.pathname}` : truncate(scrubbed(title))
}

function toolName(value: unknown, prefix: string): string {
  if (!isRecord(value)) {
    return ""
  }
  const name = [stringOf(value.name), stringOf(value.version)].filter(Boolean).join(" ")
  return name ? `${prefix}${name}` : ""
}

function mimeOf(value: unknown): string {
  return stringOf(value).toLowerCase().split(";")[0]?.trim() ?? ""
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

function rawString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function stringOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

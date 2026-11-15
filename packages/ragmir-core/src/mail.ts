import type { StructuredSection } from "./structured-formats.js"

/**
 * Bounded MIME reader for mail and saved web pages: `.eml`, `.emlx`, `.mbox`, `.mhtml`. Bodies are
 * decoded from base64 and quoted-printable in their declared charset, HTML becomes text, and binary
 * attachments are listed by name instead of indexed.
 */

/** Renders one HTML part as plain text; parsing supplies the same converter as for `.html` files. */
export type HtmlRenderer = (html: string) => string

interface MimeHeaders {
  values: Map<string, string[]>
}

interface MimeEntity {
  headers: MimeHeaders
  /** Body bytes as a latin1 string, one character per byte, before transfer decoding. */
  body: string
}

interface ContentType {
  type: string
  params: Map<string, string>
}

interface RenderState {
  parts: number
  attachments: string[]
}

interface MailMessage {
  subject: string
  from: string
  to: string
  cc: string
  date: string
  attachments: string[]
  body: string
}

// Nested multiparts and forwarded messages deeper than this are listed, not opened.
const MAX_MIME_DEPTH = 8
// One message rarely has more than a few dozen parts; a crafted one cannot fan out further.
const MAX_MIME_PARTS = 1_000
// A single decoded text part is bounded so one pasted log cannot fill the index.
const MAX_PART_TEXT_CHARACTERS = 2_000_000
const MAX_SECTION_LABEL_CHARACTERS = 80
const ENCODED_WORD = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/gu
const ENCODED_WORD_GAP = /(=\?[^?\s]+\?[BbQq]\?[^?\s]*\?=)\s+(?==\?[^?\s]+\?[BbQq]\?)/gu

/** Text of one `.eml` message: its main headers, body, and attachment names. */
export function emlText(buffer: Buffer, renderHtml: HtmlRenderer): string {
  return mailMessageText(readMailMessage(buffer.toString("latin1"), renderHtml))
}

/** Apple Mail `.emlx`: a byte count line, the RFC 822 message, then an XML property list. */
export function emlxText(buffer: Buffer, renderHtml: HtmlRenderer): string {
  const newline = buffer.indexOf(0x0a)
  const length =
    newline > 0 ? Number.parseInt(buffer.subarray(0, newline).toString("ascii"), 10) : NaN
  const message =
    Number.isSafeInteger(length) && length > 0
      ? buffer.subarray(newline + 1, newline + 1 + length)
      : buffer
  return emlText(message, renderHtml)
}

/** One section per message of an `.mbox` mailbox, labelled with its number and subject. */
export function mboxSections(buffer: Buffer, renderHtml: HtmlRenderer): StructuredSection[] {
  const sections: StructuredSection[] = []
  for (const [index, raw] of mboxMessages(buffer.toString("latin1")).entries()) {
    const message = readMailMessage(raw, renderHtml)
    const subject = singleLine(message.subject) || "(no subject)"
    sections.push({
      label: truncateLabel(`Message ${index + 1}: ${subject}`),
      text: mailMessageText(message),
    })
  }
  return sections
}

/** Saved web page (`.mhtml`, `.mht`): the page title, its address, and the rendered HTML. */
export function mhtmlText(buffer: Buffer, renderHtml: HtmlRenderer): string {
  const entity = parseEntity(buffer.toString("latin1"))
  const state: RenderState = { parts: 0, attachments: [] }
  const html = firstPartOfType(entity, "text/html", state, 0)
  const title = decodeHeaderValue(header(entity.headers, "subject"))
  const location = header(entity.headers, "snapshot-content-location")
  const body = html ? renderHtml(decodedText(html)) : ""
  return [title && `Title: ${title}`, location && `Address: ${location}`, body]
    .filter(Boolean)
    .join("\n\n")
}

function readMailMessage(raw: string, renderHtml: HtmlRenderer): MailMessage {
  return messageFromEntity(parseEntity(raw), renderHtml, { parts: 0, attachments: [] }, 0)
}

/** The message's own attachments are listed; the part budget is shared with its container. */
function messageFromEntity(
  entity: MimeEntity,
  renderHtml: HtmlRenderer,
  state: RenderState,
  depth: number,
): MailMessage {
  const own: RenderState = { parts: state.parts, attachments: [] }
  const body = renderEntity(entity, renderHtml, own, depth)
  state.parts = own.parts
  return {
    subject: decodeHeaderValue(header(entity.headers, "subject")),
    from: decodeHeaderValue(header(entity.headers, "from")),
    to: decodeHeaderValue(header(entity.headers, "to")),
    cc: decodeHeaderValue(header(entity.headers, "cc")),
    date: decodeHeaderValue(header(entity.headers, "date")),
    attachments: own.attachments,
    body,
  }
}

function mailMessageText(message: MailMessage): string {
  return [
    message.subject && `Subject: ${message.subject}`,
    message.from && `From: ${message.from}`,
    message.to && `To: ${message.to}`,
    message.cc && `Cc: ${message.cc}`,
    message.date && `Date: ${message.date}`,
    message.attachments.length > 0 && `Attachments: ${message.attachments.join(", ")}`,
    "",
    message.body.trim(),
  ]
    .filter((line): line is string => line !== false && line !== null)
    .join("\n")
    .trim()
}

/**
 * Split a mailbox on its `From ` separator lines. A separator starts the file or follows an empty
 * line, so a body line that begins with "From " does not split a message; `>From ` escapes are
 * restored.
 */
function mboxMessages(content: string): string[] {
  const lines = content.split(/\r?\n/u)
  const messages: string[] = []
  let current: string[] | null = null
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ""
    const previous = index > 0 ? lines[index - 1] : ""
    if (line.startsWith("From ") && (index === 0 || previous === "")) {
      if (current) {
        messages.push(current.join("\n"))
      }
      current = []
      continue
    }
    if (current) {
      current.push(line.replace(/^>(>*From )/u, "$1"))
    }
  }
  if (current) {
    messages.push(current.join("\n"))
  }
  // A file without separators is a single message saved with the wrong extension.
  return messages.length > 0 ? messages.filter((message) => message.trim()) : [content]
}

function parseEntity(raw: string): MimeEntity {
  const separator = /\r?\n\r?\n/u.exec(raw)
  const head = separator ? raw.slice(0, separator.index) : raw
  const body = separator ? raw.slice(separator.index + separator[0].length) : ""
  return { headers: parseHeaders(head), body }
}

function parseHeaders(head: string): MimeHeaders {
  const values = new Map<string, string[]>()
  let name: string | null = null
  let value = ""
  const flush = () => {
    if (name) {
      const list = values.get(name) ?? []
      list.push(value.trim())
      values.set(name, list)
    }
  }
  for (const line of head.split(/\r?\n/u)) {
    if (/^[ \t]/u.test(line) && name) {
      value += ` ${line.trim()}`
      continue
    }
    const colon = line.indexOf(":")
    if (colon <= 0) {
      continue
    }
    flush()
    name = line.slice(0, colon).trim().toLowerCase()
    value = line.slice(colon + 1)
  }
  flush()
  return { values }
}

function header(headers: MimeHeaders, name: string): string {
  return headers.values.get(name)?.[0] ?? ""
}

function contentType(entity: MimeEntity): ContentType {
  const parsed = parseParameterized(header(entity.headers, "content-type"))
  return { type: parsed.value.toLowerCase() || "text/plain", params: parsed.params }
}

function parseParameterized(value: string): { value: string; params: Map<string, string> } {
  const params = new Map<string, string>()
  const [first = "", ...rest] = splitParameters(value)
  const continued = new Map<string, Array<{ index: number; value: string; encoded: boolean }>>()
  for (const part of rest) {
    const equals = part.indexOf("=")
    if (equals <= 0) {
      continue
    }
    const key = part.slice(0, equals).trim().toLowerCase()
    let parameter = part.slice(equals + 1).trim()
    if (parameter.startsWith('"') && parameter.endsWith('"') && parameter.length >= 2) {
      parameter = parameter.slice(1, -1).replace(/\\(.)/gu, "$1")
    }
    // RFC 2231: name*=charset''percent-encoded, and name*0, name*1 continuations.
    const extended = /^([^*]+)\*(?:(\d+)\*?)?$/u.exec(key)
    if (extended?.[1]) {
      const list = continued.get(extended[1]) ?? []
      list.push({
        index: Number(extended[2] ?? 0),
        value: parameter,
        encoded: key.endsWith("*"),
      })
      continued.set(extended[1], list)
      continue
    }
    params.set(key, decodeHeaderValue(parameter))
  }
  for (const [key, list] of continued) {
    list.sort((left, right) => left.index - right.index)
    const joined = list.map((entry) => entry.value).join("")
    params.set(key, list.some((entry) => entry.encoded) ? decodeRfc2231(joined) : joined)
  }
  return { value: first.trim(), params }
}

function splitParameters(value: string): string[] {
  const parts: string[] = []
  let current = ""
  let quoted = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? ""
    if (character === "\\" && quoted) {
      current += character + (value[index + 1] ?? "")
      index += 1
      continue
    }
    if (character === '"') {
      quoted = !quoted
    }
    if (character === ";" && !quoted) {
      parts.push(current)
      current = ""
      continue
    }
    current += character
  }
  parts.push(current)
  return parts
}

function decodeRfc2231(value: string): string {
  const match = /^([^']*)'[^']*'(.*)$/u.exec(value)
  const charset = match?.[1] || "utf-8"
  const encoded = match ? (match[2] ?? "") : value
  const bytes = Buffer.from(
    encoded.replace(/%([0-9A-Fa-f]{2})/gu, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    ),
    "latin1",
  )
  return decodeBytes(bytes, charset)
}

/** RFC 2047 encoded words, and raw UTF-8 that RFC 6532 allows in headers. */
function decodeHeaderValue(value: string): string {
  if (!value) {
    return ""
  }
  const joined = value.replace(ENCODED_WORD_GAP, "$1")
  let decoded = ""
  let last = 0
  for (const match of joined.matchAll(ENCODED_WORD)) {
    decoded += rawHeaderText(joined.slice(last, match.index))
    const [, charset = "utf-8", encoding = "B", text = ""] = match
    const bytes =
      encoding.toUpperCase() === "B"
        ? Buffer.from(text, "base64")
        : Buffer.from(decodeQuotedPrintable(text.replace(/_/gu, " ")), "latin1")
    decoded += decodeBytes(bytes, charset)
    last = (match.index ?? 0) + match[0].length
  }
  decoded += rawHeaderText(joined.slice(last))
  return decoded.replace(/\s+/gu, " ").trim()
}

function rawHeaderText(value: string): string {
  const bytes = Buffer.from(value, "latin1")
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return value
  }
}

function renderEntity(
  entity: MimeEntity,
  renderHtml: HtmlRenderer,
  state: RenderState,
  depth: number,
): string {
  state.parts += 1
  if (state.parts > MAX_MIME_PARTS || depth > MAX_MIME_DEPTH) {
    return ""
  }
  const type = contentType(entity)
  const disposition = parseParameterized(header(entity.headers, "content-disposition"))
  const fileName = disposition.params.get("filename") ?? type.params.get("name") ?? ""
  const attachment = disposition.value.toLowerCase() === "attachment"

  if (type.type.startsWith("multipart/")) {
    const parts = multipartParts(entity, type)
    if (type.type === "multipart/alternative") {
      // Plain text indexes cleanest; HTML, or the richest alternative, fills in when it is empty.
      const plain = parts.find((part) => contentType(part).type === "text/plain")
      const plainText = plain ? decodedText(plain).trim() : ""
      if (plainText) {
        return plainText
      }
      const preferred = parts.find((part) => contentType(part).type === "text/html") ?? parts.at(-1)
      return preferred ? renderEntity(preferred, renderHtml, state, depth + 1) : ""
    }
    return parts
      .map((part) => renderEntity(part, renderHtml, state, depth + 1))
      .filter((text) => text.trim())
      .join("\n\n")
  }

  if (type.type === "message/rfc822" || type.type === "message/global") {
    if (depth + 1 > MAX_MIME_DEPTH) {
      return ""
    }
    const nested = parseEntity(decodedBytes(entity).toString("latin1"))
    const forwarded = mailMessageText(messageFromEntity(nested, renderHtml, state, depth + 1))
    return forwarded ? `Forwarded message:\n${forwarded}` : ""
  }

  if (type.type === "text/plain" || type.type === "text/calendar") {
    const text = decodedText(entity)
    if (attachment && fileName) {
      state.attachments.push(fileName)
      return text.trim() ? `Attachment ${fileName}:\n${text}` : ""
    }
    return text
  }

  if (type.type === "text/html" && !(attachment && fileName)) {
    return renderHtml(decodedText(entity))
  }

  if (fileName) {
    state.attachments.push(fileName)
  }
  return ""
}

function firstPartOfType(
  entity: MimeEntity,
  wanted: string,
  state: RenderState,
  depth: number,
): MimeEntity | null {
  state.parts += 1
  if (state.parts > MAX_MIME_PARTS || depth > MAX_MIME_DEPTH) {
    return null
  }
  const type = contentType(entity)
  if (type.type === wanted) {
    return entity
  }
  if (!type.type.startsWith("multipart/")) {
    return null
  }
  for (const part of multipartParts(entity, type)) {
    const found = firstPartOfType(part, wanted, state, depth + 1)
    if (found) {
      return found
    }
  }
  return null
}

function multipartParts(entity: MimeEntity, type: ContentType): MimeEntity[] {
  const boundary = type.params.get("boundary")
  if (!boundary) {
    return []
  }
  const delimiter = `--${boundary}`
  const parts: MimeEntity[] = []
  let current: string[] | null = null
  for (const line of entity.body.split(/\r?\n/u)) {
    const trimmed = line.trimEnd()
    if (trimmed === `${delimiter}--`) {
      if (current) {
        parts.push(parseEntity(current.join("\n")))
      }
      current = null
      break
    }
    if (trimmed === delimiter) {
      if (current) {
        parts.push(parseEntity(current.join("\n")))
      }
      current = []
      if (parts.length >= MAX_MIME_PARTS) {
        break
      }
      continue
    }
    current?.push(line)
  }
  if (current && current.length > 0) {
    parts.push(parseEntity(current.join("\n")))
  }
  return parts
}

function decodedBytes(entity: MimeEntity): Buffer {
  const encoding = header(entity.headers, "content-transfer-encoding").trim().toLowerCase()
  if (encoding === "base64") {
    return Buffer.from(entity.body.replace(/[^A-Za-z0-9+/=]/gu, ""), "base64")
  }
  if (encoding === "quoted-printable") {
    return Buffer.from(decodeQuotedPrintable(entity.body), "latin1")
  }
  return Buffer.from(entity.body, "latin1")
}

function decodedText(entity: MimeEntity): string {
  const charset = contentType(entity).params.get("charset") ?? "utf-8"
  const text = decodeBytes(decodedBytes(entity), charset)
  return text.length > MAX_PART_TEXT_CHARACTERS ? text.slice(0, MAX_PART_TEXT_CHARACTERS) : text
}

function decodeQuotedPrintable(value: string): string {
  return value
    .replace(/=\r?\n/gu, "")
    .replace(/=([0-9A-Fa-f]{2})/gu, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
}

function decodeBytes(bytes: Buffer, charset: string): string {
  const label = charset.trim().toLowerCase().replace(/^"|"$/gu, "")
  try {
    return new TextDecoder(label || "utf-8").decode(bytes)
  } catch {
    return new TextDecoder("utf-8").decode(bytes)
  }
}

function singleLine(value: string): string {
  return value.replace(/\s+/gu, " ").trim()
}

function truncateLabel(label: string): string {
  return label.length > MAX_SECTION_LABEL_CHARACTERS
    ? `${label.slice(0, MAX_SECTION_LABEL_CHARACTERS - 1).trimEnd()}…`
    : label
}

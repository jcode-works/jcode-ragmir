import * as zlib from "node:zlib"
import { unzipSync } from "fflate"
import { figmaSections } from "./design-formats.js"
import { isRecord } from "./guards.js"
import type { StructuredSection } from "./structured-formats.js"

/**
 * Figma, FigJam, and Slides files saved with "Save local copy" (`.fig`). The file is a ZIP that holds
 * `canvas.fig`, a Kiwi-encoded document: a binary schema chunk, then a message chunk with every node.
 * Nodes are decoded against the file's own schema, so new Figma fields never break the reader, and
 * the tree is cited like a Figma REST export: one section per top-level frame of each page.
 */

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd]
const CANVAS_ENTRY = "canvas.fig"
// A decompressed document is bounded; vector blobs make most of a large file and stay as views.
const MAX_DECOMPRESSED_BYTES = 256 * 1024 * 1024
const MAX_KIWI_DEPTH = 64
const KIND_NAMES = ["ENUM", "STRUCT", "MESSAGE"] as const
const BUILTIN_TYPES = ["bool", "byte", "int", "uint", "float", "string", "int64", "uint64"] as const
// Slides group their slides in grids and rows; each slide is cited on its own.
const SLIDE_CONTAINERS = new Set(["SLIDE_GRID", "SLIDE_ROW"])

type KiwiKind = (typeof KIND_NAMES)[number]

interface KiwiField {
  name: string
  typeName: string
  isArray: boolean
  value: number
}

interface KiwiDefinition {
  name: string
  kind: KiwiKind
  fields: KiwiField[]
  fieldsByValue: Map<number, KiwiField>
}

interface FigmaNode {
  key: string
  parentKey: string | null
  position: string
  record: Record<string, unknown>
}

export function figmaFileSections(buffer: Buffer): StructuredSection[] {
  const canvas = startsWith(buffer, ZIP_MAGIC) ? canvasEntry(buffer) : buffer
  const header = canvas.subarray(0, 8).toString("latin1")
  if (!header.startsWith("fig-")) {
    throw new Error(
      "Not a Figma design file. Figma .fig files start with a fig- header; MATLAB and Xfig figures are not indexed.",
    )
  }
  const chunks = kiwiChunks(canvas)
  const [schemaChunk, messageChunk] = chunks
  if (!schemaChunk || !messageChunk) {
    throw new Error("Figma file is truncated: its schema or document chunk is missing.")
  }
  const definitions = decodeSchema(decompress(schemaChunk))
  const root = definitions.get("Message")
  if (!root) {
    throw new Error("Figma file schema has no Message definition.")
  }
  const message = decodeDefinition(new KiwiReader(decompress(messageChunk)), root, definitions, 0)
  const nodeChanges =
    isRecord(message) && Array.isArray(message.nodeChanges) ? message.nodeChanges : []
  return figmaSections(restDocument(nodeChanges.filter(isRecord))) ?? []
}

function canvasEntry(buffer: Buffer): Buffer {
  const entries = unzipSync(new Uint8Array(buffer), {
    filter: (file) => file.name === CANVAS_ENTRY && file.originalSize <= MAX_DECOMPRESSED_BYTES,
  })
  const canvas = entries[CANVAS_ENTRY]
  if (!canvas) {
    throw new Error("Figma file has no canvas.fig document.")
  }
  return Buffer.from(canvas.buffer, canvas.byteOffset, canvas.byteLength)
}

/** Header (8-byte magic, 32-bit version), then length-prefixed chunks. */
function kiwiChunks(canvas: Buffer): Buffer[] {
  const chunks: Buffer[] = []
  let offset = 12
  while (offset + 4 <= canvas.length) {
    const length = canvas.readUInt32LE(offset)
    offset += 4
    if (offset + length > canvas.length) {
      throw new Error("Figma file is truncated: a chunk ends after the file.")
    }
    chunks.push(canvas.subarray(offset, offset + length))
    offset += length
  }
  return chunks
}

/** Each chunk is raw deflate or, in files saved since 2024, Zstandard. */
function decompress(chunk: Buffer): Buffer {
  if (!startsWith(chunk, ZSTD_MAGIC)) {
    return zlib.inflateRawSync(chunk, { maxOutputLength: MAX_DECOMPRESSED_BYTES })
  }
  // Node.js added Zstandard in 22.15; the package supports 22.12 and later.
  if (typeof zlib.zstdDecompressSync !== "function") {
    throw new Error(
      "This Figma file is compressed with Zstandard, which needs Node.js 22.15 or later.",
    )
  }
  return zlib.zstdDecompressSync(chunk, { maxOutputLength: MAX_DECOMPRESSED_BYTES })
}

function decodeSchema(bytes: Buffer): Map<string, KiwiDefinition> {
  const reader = new KiwiReader(bytes)
  const raw: Array<{ name: string; kind: KiwiKind; fields: Array<KiwiField & { type: number }> }> =
    []
  const count = reader.varUint()
  for (let index = 0; index < count; index += 1) {
    const name = reader.string()
    const kind = KIND_NAMES[reader.byte()]
    if (!kind) {
      throw new Error("Figma file schema has an unknown definition kind.")
    }
    const fieldCount = reader.varUint()
    const fields: Array<KiwiField & { type: number }> = []
    for (let field = 0; field < fieldCount; field += 1) {
      fields.push({
        name: reader.string(),
        type: reader.varInt(),
        isArray: (reader.byte() & 1) === 1,
        value: reader.varUint(),
        typeName: "",
      })
    }
    raw.push({ name, kind, fields })
  }
  const definitions = new Map<string, KiwiDefinition>()
  for (const definition of raw) {
    const fields = definition.fields.map(({ type, ...field }) => {
      const typeName = type < 0 ? BUILTIN_TYPES[~type] : raw[type]?.name
      if (!typeName) {
        throw new Error(`Figma file schema field ${definition.name}.${field.name} has no type.`)
      }
      return { ...field, typeName }
    })
    definitions.set(definition.name, {
      name: definition.name,
      kind: definition.kind,
      fields,
      fieldsByValue: new Map(fields.map((field) => [field.value, field])),
    })
  }
  return definitions
}

function decodeDefinition(
  reader: KiwiReader,
  definition: KiwiDefinition,
  definitions: Map<string, KiwiDefinition>,
  depth: number,
): unknown {
  if (depth > MAX_KIWI_DEPTH) {
    throw new Error("Figma document nests deeper than Ragmir reads.")
  }
  if (definition.kind === "ENUM") {
    const value = reader.varUint()
    return definition.fieldsByValue.get(value)?.name ?? value
  }
  const result: Record<string, unknown> = {}
  if (definition.kind === "STRUCT") {
    for (const field of definition.fields) {
      result[field.name] = decodeField(reader, field, definitions, depth)
    }
    return result
  }
  for (;;) {
    const tag = reader.varUint()
    if (tag === 0) {
      return result
    }
    const field = definition.fieldsByValue.get(tag)
    if (!field) {
      throw new Error(`Figma document has an unknown field ${tag} in ${definition.name}.`)
    }
    result[field.name] = decodeField(reader, field, definitions, depth)
  }
}

function decodeField(
  reader: KiwiReader,
  field: KiwiField,
  definitions: Map<string, KiwiDefinition>,
  depth: number,
): unknown {
  if (!field.isArray) {
    return decodeValue(reader, field.typeName, definitions, depth)
  }
  if (field.typeName === "byte") {
    return reader.bytes()
  }
  const length = reader.varUint()
  // Every element takes at least one byte, so a longer count is corrupt data.
  if (length > reader.remaining) {
    throw new Error("Figma document declares more items than it holds.")
  }
  const values: unknown[] = []
  for (let index = 0; index < length; index += 1) {
    values.push(decodeValue(reader, field.typeName, definitions, depth))
  }
  return values
}

function decodeValue(
  reader: KiwiReader,
  typeName: string,
  definitions: Map<string, KiwiDefinition>,
  depth: number,
): unknown {
  switch (typeName) {
    case "bool":
      return reader.byte() !== 0
    case "byte":
      return reader.byte()
    case "int":
      return reader.varInt()
    case "uint":
      return reader.varUint()
    case "float":
      return reader.varFloat()
    case "string":
      return reader.string()
    case "int64":
      return reader.varInt64()
    case "uint64":
      return reader.varUint64()
    default: {
      const definition = definitions.get(typeName)
      if (!definition) {
        throw new Error(`Figma file schema has no definition for ${typeName}.`)
      }
      return decodeDefinition(reader, definition, definitions, depth + 1)
    }
  }
}

/** The node changes as a Figma REST document: pages, then their frames, then text layers. */
function restDocument(nodeChanges: Record<string, unknown>[]): Record<string, unknown> {
  const nodes: FigmaNode[] = []
  for (const record of nodeChanges) {
    const key = guidKey(record.guid)
    if (!key || record.phase === "REMOVED") {
      continue
    }
    const parent = isRecord(record.parentIndex) ? record.parentIndex : undefined
    nodes.push({
      key,
      parentKey: parent ? guidKey(parent.guid) : null,
      position: typeof parent?.position === "string" ? parent.position : "",
      record,
    })
  }
  const children = new Map<string, FigmaNode[]>()
  for (const node of nodes) {
    if (node.parentKey) {
      const siblings = children.get(node.parentKey) ?? []
      siblings.push(node)
      children.set(node.parentKey, siblings)
    }
  }
  // Fractional positions order siblings by plain code unit comparison.
  for (const siblings of children.values()) {
    siblings.sort((left, right) =>
      left.position < right.position ? -1 : left.position > right.position ? 1 : 0,
    )
  }
  const components: Record<string, { name: string; description: string }> = {}
  const toRest = (node: FigmaNode, depth: number): Record<string, unknown> => {
    const record = node.record
    const type = record.type === "SYMBOL" ? "COMPONENT" : String(record.type ?? "")
    const description =
      typeof record.description === "string" && record.description.trim()
        ? record.description
        : typeof record.symbolDescription === "string"
          ? record.symbolDescription
          : ""
    if (description.trim()) {
      components[node.key] = { name: String(record.name ?? ""), description }
    }
    const textData = isRecord(record.textData) ? record.textData : {}
    // An instance keeps its main component's id and the text it overrides, such as a button label.
    const symbolData = isRecord(record.symbolData) ? record.symbolData : {}
    const componentId = guidKey(symbolData.symbolID)
    const overrides = (Array.isArray(symbolData.symbolOverrides) ? symbolData.symbolOverrides : [])
      .filter(isRecord)
      .map((override) => (isRecord(override.textData) ? override.textData.characters : undefined))
      .filter((text): text is string => typeof text === "string" && text.trim() !== "")
    const characters =
      typeof textData.characters === "string" ? textData.characters : overrides.join("\n")
    const kids = depth < MAX_KIWI_DEPTH ? (children.get(node.key) ?? []) : []
    return {
      id: node.key,
      type,
      name: typeof record.name === "string" ? record.name : "",
      visible: record.visible !== false,
      ...(componentId ? { componentId } : {}),
      ...(characters ? { characters } : {}),
      children: kids.flatMap((child) =>
        SLIDE_CONTAINERS.has(String(child.record.type))
          ? (children.get(child.key) ?? []).flatMap((row) =>
              SLIDE_CONTAINERS.has(String(row.record.type))
                ? (children.get(row.key) ?? []).map((slide) => toRest(slide, depth + 3))
                : [toRest(row, depth + 2)],
            )
          : [toRest(child, depth + 1)],
      ),
    }
  }
  const documentNode = nodes.find((node) => node.record.type === "DOCUMENT")
  const pages = (documentNode ? (children.get(documentNode.key) ?? []) : []).filter(
    (page) => page.record.type === "CANVAS" && page.record.internalOnly !== true,
  )
  return {
    document: { type: "DOCUMENT", children: pages.map((page) => toRest(page, 1)) },
    components,
  }
}

function guidKey(value: unknown): string | null {
  return isRecord(value) && typeof value.sessionID === "number" && typeof value.localID === "number"
    ? `${value.sessionID}:${value.localID}`
    : null
}

function startsWith(buffer: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((byte, index) => buffer[index] === byte)
}

/** Reader for the Kiwi wire format: LEB128 integers, zigzag signs, and null-terminated strings. */
class KiwiReader {
  private index = 0
  private readonly view: DataView

  constructor(private readonly data: Buffer) {
    this.view = new DataView(new ArrayBuffer(4))
  }

  get remaining(): number {
    return this.data.length - this.index
  }

  byte(): number {
    const value = this.data[this.index]
    if (value === undefined) {
      throw new Error("Figma document ends in the middle of a value.")
    }
    this.index += 1
    return value
  }

  varUint(): number {
    let value = 0
    let shift = 0
    let byte: number
    do {
      byte = this.byte()
      value |= (byte & 127) << shift
      shift += 7
    } while (byte & 128 && shift < 35)
    return value >>> 0
  }

  varInt(): number {
    const value = this.varUint() | 0
    return value & 1 ? ~(value >>> 1) : value >>> 1
  }

  varUint64(): number {
    return Number(this.varUint64Bits())
  }

  varInt64(): number {
    const value = this.varUint64Bits()
    return Number(value & 1n ? ~(value >> 1n) : value >> 1n)
  }

  private varUint64Bits(): bigint {
    let value = 0n
    let shift = 0n
    let byte = this.byte()
    while (byte & 128 && shift < 56n) {
      value |= BigInt(byte & 127) << shift
      shift += 7n
      byte = this.byte()
    }
    return value | (BigInt(byte) << shift)
  }

  varFloat(): number {
    const first = this.byte()
    if (first === 0) {
      return 0
    }
    let bits = first | (this.byte() << 8) | (this.byte() << 16) | (this.byte() << 24)
    // Kiwi stores the exponent first so that small integers encode in one byte.
    bits = (bits << 23) | (bits >>> 9)
    this.view.setInt32(0, bits, true)
    return this.view.getFloat32(0, true)
  }

  string(): string {
    const end = this.data.indexOf(0, this.index)
    if (end < 0) {
      throw new Error("Figma document has an unterminated string.")
    }
    const value = this.data.toString("utf8", this.index, end)
    this.index = end + 1
    return value
  }

  bytes(): Buffer {
    const length = this.varUint()
    if (length > this.remaining) {
      throw new Error("Figma document declares more bytes than it holds.")
    }
    const value = this.data.subarray(this.index, this.index + length)
    this.index += length
    return value
  }
}

import { htmlToText } from "html-to-text"

/**
 * Outlook .msg files are Compound File Binary (OLE) containers. This reader follows the MS-CFB
 * layout (FAT, mini FAT, red-black directory tree) and the MS-OXMSG property streams, with bounded
 * chains so a damaged file fails with a clear message instead of looping.
 */

const SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
const END_OF_CHAIN = 0xfffffffe
const FREE_SECTOR = 0xffffffff
const NO_STREAM = 0xffffffff
const DIRECTORY_ENTRY_BYTES = 128
const MAX_DIRECTORY_ENTRIES = 100_000

interface DirectoryEntry {
  name: string
  type: number
  left: number
  right: number
  child: number
  start: number
  size: number
}

interface CompoundFile {
  entries: DirectoryEntry[]
  read(entry: DirectoryEntry): Buffer
}

function readCompoundFile(buffer: Buffer): CompoundFile {
  if (buffer.length < 512 || !buffer.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error("Not an Outlook message: the OLE compound file signature is missing.")
  }
  const sectorSize = 2 ** buffer.readUInt16LE(0x1e)
  const miniSectorSize = 2 ** buffer.readUInt16LE(0x20)
  if (sectorSize !== 512 && sectorSize !== 4096) {
    throw new Error("Outlook message uses an unsupported sector size.")
  }
  const sectorCount = Math.floor((buffer.length - sectorSize) / sectorSize) + 1
  const sector = (index: number) => {
    const offset = (index + 1) * sectorSize
    if (index >= sectorCount || offset >= buffer.length) {
      throw new Error("Outlook message references a sector outside the file.")
    }
    return buffer.subarray(offset, Math.min(offset + sectorSize, buffer.length))
  }

  // DIFAT: 109 header entries, then chained DIFAT sectors.
  const fatSectors: number[] = []
  for (let index = 0; index < 109; index += 1) {
    const value = buffer.readUInt32LE(0x4c + index * 4)
    if (value !== FREE_SECTOR) {
      fatSectors.push(value)
    }
  }
  let difat = buffer.readUInt32LE(0x44)
  for (let guard = 0; difat !== END_OF_CHAIN && difat !== FREE_SECTOR; guard += 1) {
    if (guard > sectorCount) {
      throw new Error("Outlook message has a looping DIFAT chain.")
    }
    const data = sector(difat)
    const perSector = sectorSize / 4 - 1
    for (let index = 0; index < perSector; index += 1) {
      const value = data.readUInt32LE(index * 4)
      if (value !== FREE_SECTOR) {
        fatSectors.push(value)
      }
    }
    difat = data.readUInt32LE(perSector * 4)
  }
  const fat: number[] = []
  for (const index of fatSectors) {
    const data = sector(index)
    for (let offset = 0; offset + 4 <= data.length; offset += 4) {
      fat.push(data.readUInt32LE(offset))
    }
  }

  const chain = (start: number, table: number[], limit: number): number[] => {
    const sectors: number[] = []
    let current = start
    while (current !== END_OF_CHAIN && current !== FREE_SECTOR) {
      if (sectors.length > limit || current >= table.length) {
        throw new Error("Outlook message has a broken sector chain.")
      }
      sectors.push(current)
      current = table[current] ?? END_OF_CHAIN
    }
    return sectors
  }
  const readRegular = (start: number, size: number) =>
    Buffer.concat(chain(start, fat, sectorCount).map(sector)).subarray(0, size)

  const directory = readRegular(buffer.readUInt32LE(0x30), Number.MAX_SAFE_INTEGER)
  const entries: DirectoryEntry[] = []
  for (
    let offset = 0;
    offset + DIRECTORY_ENTRY_BYTES <= directory.length && entries.length < MAX_DIRECTORY_ENTRIES;
    offset += DIRECTORY_ENTRY_BYTES
  ) {
    const nameBytes = Math.min(directory.readUInt16LE(offset + 64), 64)
    entries.push({
      name: directory.toString("utf16le", offset, offset + Math.max(0, nameBytes - 2)),
      type: directory.readUInt8(offset + 66),
      left: directory.readUInt32LE(offset + 68),
      right: directory.readUInt32LE(offset + 72),
      child: directory.readUInt32LE(offset + 76),
      start: directory.readUInt32LE(offset + 116),
      size: directory.readUInt32LE(offset + 120),
    })
  }
  const root = entries[0]
  if (root?.type !== 5) {
    throw new Error("Outlook message has no root storage.")
  }

  const miniCutoff = buffer.readUInt32LE(0x38)
  const miniFatStart = buffer.readUInt32LE(0x3c)
  const miniFat: number[] = []
  if (miniFatStart !== END_OF_CHAIN) {
    const data = readRegular(miniFatStart, Number.MAX_SAFE_INTEGER)
    for (let offset = 0; offset + 4 <= data.length; offset += 4) {
      miniFat.push(data.readUInt32LE(offset))
    }
  }
  let miniStream: Buffer | undefined
  const read = (entry: DirectoryEntry): Buffer => {
    if (entry.size === 0) {
      return Buffer.alloc(0)
    }
    if (entry.size >= miniCutoff || entry === root) {
      return readRegular(entry.start, entry.size)
    }
    miniStream ??= readRegular(root.start, root.size)
    const stream = miniStream
    return Buffer.concat(
      chain(entry.start, miniFat, miniFat.length).map((index) =>
        stream.subarray(index * miniSectorSize, (index + 1) * miniSectorSize),
      ),
    ).subarray(0, entry.size)
  }
  return { entries, read }
}

/** Direct children of a storage, walking its red-black sibling tree. */
function childrenOf(file: CompoundFile, storage: DirectoryEntry): DirectoryEntry[] {
  const children: DirectoryEntry[] = []
  const seen = new Set<number>()
  const pending = [storage.child]
  while (pending.length > 0) {
    const index = pending.pop() as number
    if (index === NO_STREAM || seen.has(index)) {
      continue
    }
    const entry = file.entries[index]
    if (!entry) {
      continue
    }
    seen.add(index)
    children.push(entry)
    pending.push(entry.left, entry.right)
  }
  return children
}

interface PropertyStreams {
  strings: Map<number, string>
  binary: Map<number, Buffer>
  fixed: Map<number, Buffer>
}

function propertyStreams(
  file: CompoundFile,
  storage: DirectoryEntry,
  headerBytes: number,
): PropertyStreams {
  const strings = new Map<number, string>()
  const binary = new Map<number, Buffer>()
  const fixed = new Map<number, Buffer>()
  for (const entry of childrenOf(file, storage)) {
    if (entry.type !== 2) {
      continue
    }
    const match = /^__substg1\.0_([0-9A-F]{4})([0-9A-F]{4})$/iu.exec(entry.name)
    if (match) {
      const id = Number.parseInt(match[1] ?? "0", 16)
      const type = Number.parseInt(match[2] ?? "0", 16)
      const data = file.read(entry)
      if (type === 0x001f) {
        strings.set(id, data.toString("utf16le").replace(/\0+$/u, ""))
      } else if (type === 0x001e) {
        strings.set(id, data.toString("latin1").replace(/\0+$/u, ""))
      } else if (type === 0x0102) {
        binary.set(id, data)
      }
      continue
    }
    if (entry.name === "__properties_version1.0") {
      const data = file.read(entry)
      for (let offset = headerBytes; offset + 16 <= data.length; offset += 16) {
        fixed.set(data.readUInt16LE(offset + 2), data.subarray(offset + 8, offset + 16))
      }
    }
  }
  return { strings, binary, fixed }
}

function fileTime(value: Buffer | undefined): string {
  if (!value || value.length < 8) {
    return ""
  }
  const ticks = value.readBigUInt64LE(0)
  if (ticks === 0n) {
    return ""
  }
  const milliseconds = Number(ticks / 10_000n) - 11_644_473_600_000
  const date = new Date(milliseconds)
  return Number.isNaN(date.getTime()) ? "" : date.toISOString()
}

/** Headers, recipients, attachment names, and the plain or HTML body of an Outlook message. */
export function outlookMessageText(buffer: Buffer): string {
  const file = readCompoundFile(buffer)
  const root = file.entries[0] as DirectoryEntry
  const message = propertyStreams(file, root, 32)
  const text = (id: number) => message.strings.get(id)?.trim() ?? ""

  const senderName = text(0x0c1a) || text(0x0042)
  const senderAddress = text(0x5d01) || text(0x0c1f)
  const sender =
    senderName && senderAddress && senderName !== senderAddress
      ? `${senderName} <${senderAddress}>`
      : senderName || senderAddress

  const attachments: string[] = []
  const recipients: string[] = []
  for (const entry of childrenOf(file, root)) {
    if (entry.type !== 1) {
      continue
    }
    if (entry.name.startsWith("__attach_version1.0_")) {
      const properties = propertyStreams(file, entry, 8)
      const name =
        properties.strings.get(0x3707) ??
        properties.strings.get(0x3704) ??
        properties.strings.get(0x3001)
      if (name?.trim()) {
        attachments.push(name.trim())
      }
    } else if (entry.name.startsWith("__recip_version1.0_")) {
      const properties = propertyStreams(file, entry, 8)
      const name = properties.strings.get(0x3001)?.trim() ?? ""
      const address = (
        properties.strings.get(0x39fe) ??
        properties.strings.get(0x3003) ??
        ""
      ).trim()
      const recipient =
        name && address && name !== address ? `${name} <${address}>` : name || address
      if (recipient) {
        recipients.push(recipient)
      }
    }
  }

  let body = text(0x1000)
  if (!body) {
    const html = message.binary.get(0x1013)?.toString("utf8") ?? text(0x1013)
    if (html) {
      body = htmlToText(html, {
        wordwrap: false,
        selectors: [
          { selector: "a", options: { ignoreHref: true } },
          { selector: "img", format: "skip" },
        ],
      })
    }
  }

  const header = [
    ["Subject", text(0x0037) || text(0x0070)],
    ["From", sender],
    ["To", text(0x0e04)],
    ["Cc", text(0x0e03)],
    ["Recipients", text(0x0e04) ? "" : recipients.join(", ")],
    ["Date", fileTime(message.fixed.get(0x0039)) || fileTime(message.fixed.get(0x0e06))],
    ["Attachments", attachments.join(", ")],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
  return [...header, "", body.trim()].join("\n").trim()
}

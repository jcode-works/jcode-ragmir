import { createReadStream } from "node:fs"

/**
 * Read a JSON Lines file and hand each parsed line to `accept`. Returns false as soon as a line is
 * empty, not JSON, or rejected, so a truncated or tampered file is never half trusted. Errors
 * opening or reading the file, ENOENT included, reach the caller.
 */
export async function acceptJsonLines(
  filePath: string,
  accept: (value: unknown) => boolean,
): Promise<boolean> {
  const acceptLine = (line: string): boolean => {
    let value: unknown
    try {
      value = JSON.parse(line) as unknown
    } catch {
      return false
    }
    return accept(value)
  }
  const stream = createReadStream(filePath)
  stream.setEncoding("utf8")
  let buffered = ""
  for await (const chunk of stream) {
    buffered += typeof chunk === "string" ? chunk : chunk.toString("utf8")
    let lineEnd = buffered.indexOf("\n")
    while (lineEnd >= 0) {
      const line = buffered.slice(0, lineEnd)
      buffered = buffered.slice(lineEnd + 1)
      if (!line || !acceptLine(line)) {
        return false
      }
      lineEnd = buffered.indexOf("\n")
    }
  }
  return !buffered || acceptLine(buffered)
}

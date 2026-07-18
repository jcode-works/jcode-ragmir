export const DEFAULT_CLI_STDIN_MAX_BYTES = 64 * 1024

export async function readBoundedStdin(
  input: AsyncIterable<string | Uint8Array>,
  maxBytes = DEFAULT_CLI_STDIN_MAX_BYTES,
): Promise<string> {
  const chunks: Buffer[] = []
  let totalBytes = 0

  for await (const chunk of input) {
    const buffer = Buffer.from(chunk)
    totalBytes += buffer.byteLength
    if (totalBytes > maxBytes) {
      throw new Error(`Standard input exceeds the ${maxBytes}-byte CLI limit.`)
    }
    chunks.push(buffer)
  }

  return Buffer.concat(chunks, totalBytes).toString("utf8")
}

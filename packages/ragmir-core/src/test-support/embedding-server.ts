import { createServer, type IncomingMessage } from "node:http"
import type { AddressInfo } from "node:net"

export interface EmbeddingRequest {
  path: string
  authorization: string | undefined
  body: { model: string; input: string[] }
}

export interface EmbeddingServer {
  /** The OpenAI-compatible base URL, ending in `/v1`. */
  endpoint: string
  requests: EmbeddingRequest[]
  close(): Promise<void>
}

/** A local stand-in for Ollama or vLLM: answers `/v1/embeddings` with one vector per input. */
export async function startEmbeddingServer(
  reply: (body: EmbeddingRequest["body"]) => { status?: number; payload: unknown },
): Promise<EmbeddingServer> {
  const requests: EmbeddingRequest[] = []
  const server = createServer(async (request: IncomingMessage, response) => {
    let raw = ""
    for await (const chunk of request) raw += chunk
    const body = JSON.parse(raw) as EmbeddingRequest["body"]
    requests.push({ path: request.url ?? "", authorization: request.headers.authorization, body })
    const { status = 200, payload } = reply(body)
    response.writeHead(status, { "content-type": "application/json" })
    response.end(JSON.stringify(payload))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
  const { port } = server.address() as AddressInfo
  return {
    endpoint: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

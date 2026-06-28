import { Ollama } from "ollama"
import { assertNetworkPolicy } from "./network.js"
import type { Config } from "./types.js"

export async function embedTexts(texts: string[], config: Config): Promise<number[][]> {
  if (texts.length === 0) {
    return []
  }

  assertNetworkPolicy(config)
  const client = new Ollama({ host: config.ollamaHost })
  const response = await client.embed({
    model: config.embedModel,
    input: texts,
  })

  if (!response.embeddings || response.embeddings.length !== texts.length) {
    throw new Error(
      `Expected ${texts.length} embeddings, received ${response.embeddings?.length ?? 0}.`,
    )
  }

  return response.embeddings
}

export async function embedText(text: string, config: Config): Promise<number[]> {
  const [embedding] = await embedTexts([text], config)
  if (!embedding) {
    throw new Error("No embedding returned for query.")
  }
  return embedding
}

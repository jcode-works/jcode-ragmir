import { findProjectConfig } from "./config.js"
import { DEFAULT_CONFIG, defaultEmbeddingModelRevision } from "./defaults.js"
import { initProject } from "./init.js"
import { mutateProjectConfig } from "./project-config-file.js"

export interface EnableSemanticEmbeddingsResult {
  configPath: string
  embeddingProvider: "transformers"
  embeddingModel: string
  embeddingModelRevision: string
  embeddingModelDigest: string | null
  embeddingModelPath: string
  transformersAllowRemoteModels: false
}

export interface SemanticEmbeddingArtifact {
  embeddingModelRevision: string
  embeddingModelDigest: string
}

export async function enableSemanticEmbeddings(
  cwd = process.cwd(),
  artifact?: SemanticEmbeddingArtifact,
): Promise<EnableSemanticEmbeddingsResult> {
  if (artifact && !/^[0-9a-f]{40}$/u.test(artifact.embeddingModelRevision)) {
    throw new Error(
      "The resolved embedding model revision must be an immutable 40-character commit hash before enabling semantic embeddings.",
    )
  }
  if (artifact && !/^sha256:[0-9a-f]{64}$/u.test(artifact.embeddingModelDigest)) {
    throw new Error("The resolved embedding model digest must be a lowercase SHA-256 identity.")
  }
  await initProject(cwd)
  const projectConfig = findProjectConfig(cwd)

  const { embeddingModel, embeddingModelRevision, embeddingModelDigest, embeddingModelPath } =
    await mutateProjectConfig(projectConfig, (rawConfig) => {
      const embeddingModel =
        typeof rawConfig.embeddingModel === "string"
          ? rawConfig.embeddingModel
          : DEFAULT_CONFIG.embeddingModel
      const embeddingModelPath =
        typeof rawConfig.embeddingModelPath === "string"
          ? rawConfig.embeddingModelPath
          : DEFAULT_CONFIG.embeddingModelPath
      const embeddingModelRevision =
        artifact?.embeddingModelRevision ??
        (typeof rawConfig.embeddingModelRevision === "string"
          ? rawConfig.embeddingModelRevision
          : defaultEmbeddingModelRevision(embeddingModel))
      const embeddingModelDigest =
        artifact?.embeddingModelDigest ??
        (typeof rawConfig.embeddingModelDigest === "string"
          ? rawConfig.embeddingModelDigest
          : DEFAULT_CONFIG.embeddingModelDigest)
      Object.assign(rawConfig, {
        embeddingProvider: "transformers",
        embeddingModel,
        embeddingModelRevision,
        embeddingModelDigest,
        embeddingModelPath,
        transformersAllowRemoteModels: false,
      })
      return {
        changed: true,
        value: {
          embeddingModel,
          embeddingModelRevision,
          embeddingModelDigest,
          embeddingModelPath,
        },
      }
    })

  return {
    configPath: projectConfig.configPath,
    embeddingProvider: "transformers",
    embeddingModel,
    embeddingModelRevision,
    embeddingModelDigest,
    embeddingModelPath,
    transformersAllowRemoteModels: false,
  }
}

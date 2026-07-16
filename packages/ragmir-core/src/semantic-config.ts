import { findProjectConfig } from "./config.js"
import { DEFAULT_CONFIG } from "./defaults.js"
import { initProject } from "./init.js"
import { mutateProjectConfig } from "./project-config-file.js"

export interface EnableSemanticEmbeddingsResult {
  configPath: string
  embeddingProvider: "transformers"
  embeddingModel: string
  embeddingModelPath: string
  transformersAllowRemoteModels: false
}

export async function enableSemanticEmbeddings(
  cwd = process.cwd(),
): Promise<EnableSemanticEmbeddingsResult> {
  await initProject(cwd)
  const projectConfig = findProjectConfig(cwd)

  const { embeddingModel, embeddingModelPath } = await mutateProjectConfig(
    projectConfig,
    (rawConfig) => {
      const embeddingModel =
        typeof rawConfig.embeddingModel === "string"
          ? rawConfig.embeddingModel
          : DEFAULT_CONFIG.embeddingModel
      const embeddingModelPath =
        typeof rawConfig.embeddingModelPath === "string"
          ? rawConfig.embeddingModelPath
          : DEFAULT_CONFIG.embeddingModelPath
      Object.assign(rawConfig, {
        embeddingProvider: "transformers",
        embeddingModel,
        embeddingModelPath,
        transformersAllowRemoteModels: false,
      })
      return { changed: true, value: { embeddingModel, embeddingModelPath } }
    },
  )

  return {
    configPath: projectConfig.configPath,
    embeddingProvider: "transformers",
    embeddingModel,
    embeddingModelPath,
    transformersAllowRemoteModels: false,
  }
}

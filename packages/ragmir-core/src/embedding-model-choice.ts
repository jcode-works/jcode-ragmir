import { readFile } from "node:fs/promises"
import { findProjectConfig, readMergedProjectConfig } from "./config.js"
import { DEFAULT_CONFIG, defaultEmbeddingModelRevision } from "./defaults.js"
import {
  assessEmbeddingModel,
  embeddingModelProfile,
  type ModelAssessment,
  recommendEmbeddingModel,
} from "./embedding-models.js"
import { detectHardware, type HardwareProfile } from "./hardware.js"
import type { Config } from "./types.js"

export interface EmbeddingModelChoice {
  embeddingModel: string
  embeddingModelRevision: string
  /**
   * Why this model: named on the command line, already set in the project config (kept so every
   * workstation indexes with the same model), recommended for this machine, or the built-in default.
   */
  source: "requested" | "configured" | "recommended" | "default"
  /** How the model suits this machine, when Ragmir knows the model. */
  assessment: ModelAssessment | null
}

/**
 * Picks the semantic model for `rgr setup --semantic` and `rgr models pull`. An explicit request
 * wins, then a model the shared config already names, then the recommendation for this hardware.
 * The caller writes the choice to the project config, so teammates reuse it instead of their own.
 */
export async function chooseEmbeddingModel(
  cwd: string,
  config: Config,
  requested?: string,
  hardware?: HardwareProfile,
): Promise<EmbeddingModelChoice> {
  const machine = hardware ?? (await detectHardware())
  const assess = (model: string): ModelAssessment | null => {
    const profile = embeddingModelProfile(model)
    return profile ? assessEmbeddingModel(profile, machine) : null
  }

  if (requested) {
    return {
      embeddingModel: requested,
      embeddingModelRevision:
        requested === config.embeddingModel
          ? config.embeddingModelRevision
          : defaultEmbeddingModelRevision(requested),
      source: "requested",
      assessment: assess(requested),
    }
  }
  if (await projectChoseEmbeddingModel(cwd)) {
    return {
      embeddingModel: config.embeddingModel,
      embeddingModelRevision: config.embeddingModelRevision,
      source: "configured",
      assessment: assess(config.embeddingModel),
    }
  }
  const recommended = recommendEmbeddingModel(machine)
  if (recommended) {
    return {
      embeddingModel: recommended.model.id,
      embeddingModelRevision: recommended.model.revision,
      source: "recommended",
      assessment: recommended,
    }
  }
  return {
    embeddingModel: config.embeddingModel,
    embeddingModelRevision: config.embeddingModelRevision,
    source: "default",
    assessment: assess(config.embeddingModel),
  }
}

/**
 * Whether the project already settled on a model. A model in the committed `ragmir.config.json` is
 * a team decision. The local config that `rgr init` writes repeats every default, so there only an
 * enabled semantic provider or a model other than the default counts as a choice.
 */
async function projectChoseEmbeddingModel(cwd: string): Promise<boolean> {
  try {
    const location = findProjectConfig(cwd)
    if (location.sharedConfigPath) {
      const shared: unknown = JSON.parse(await readFile(location.sharedConfigPath, "utf8"))
      if (
        typeof shared === "object" &&
        shared !== null &&
        typeof (shared as { embeddingModel?: unknown }).embeddingModel === "string"
      ) {
        return true
      }
    }
    const merged = await readMergedProjectConfig(location)
    return (
      merged.embeddingProvider === "transformers" ||
      (typeof merged.embeddingModel === "string" &&
        merged.embeddingModel !== DEFAULT_CONFIG.embeddingModel)
    )
  } catch {
    return false
  }
}

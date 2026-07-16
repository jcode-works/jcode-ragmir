import { existsSync, statSync } from "node:fs"
import path from "node:path"
import {
  DEFAULT_CHAT_ALLOW_REMOTE_MODELS,
  DEFAULT_CHAT_CONTEXT_CHAR_LIMIT,
  DEFAULT_CHAT_MAX_NEW_TOKENS,
  DEFAULT_CHAT_MODEL,
  DEFAULT_CHAT_SETUP_ALLOW_REMOTE_MODELS,
} from "./generation.js"
import {
  chatModelDefinition,
  chatModelProfile,
  DEFAULT_CHAT_MODEL_PATH,
  DEFAULT_CHAT_PROFILE,
  inspectChatModel,
  resolveChatModelPaths,
  setupChatModelFiles,
} from "./profiles.js"
import { inspectNodeLlamaRuntime } from "./runtime.js"
import type {
  ChatModelProfile,
  DoctorOptions,
  DoctorReport,
  SetupChatModelOptions,
  SetupChatModelResult,
} from "./types.js"

export async function setupChatModel(
  options: SetupChatModelOptions = {},
): Promise<SetupChatModelResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const profile = resolveProfile(options.profile)
  const modelPath =
    options.modelPath ?? process.env.RAGMIR_CHAT_MODEL_PATH ?? DEFAULT_CHAT_MODEL_PATH
  const allowRemoteModels = options.allowRemoteModels ?? DEFAULT_CHAT_SETUP_ALLOW_REMOTE_MODELS
  return setupChatModelFiles(options, { cwd, profile, modelPath, allowRemoteModels })
}

export async function doctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const profile = resolveProfile(options.profile)
  const modelRoot =
    options.modelPath ?? process.env.RAGMIR_CHAT_MODEL_PATH ?? DEFAULT_CHAT_MODEL_PATH
  const definition = chatModelDefinition(profile)
  const paths = resolveChatModelPaths(cwd, modelRoot, profile)
  const inspection = await inspectChatModel(paths, definition, {
    verifyHash: options.verifyHash === true,
  })
  const runtimeInspection = await inspectNodeLlamaRuntime()
  const modelReady = inspection.ready && inspection.modelHashValid !== false

  return {
    node: process.versions.node,
    provider: "node-llama-cpp",
    runtimeVersion: "3.19.0",
    profile,
    defaultProfile: DEFAULT_CHAT_PROFILE,
    defaultModel: DEFAULT_CHAT_MODEL,
    defaultModelPath: DEFAULT_CHAT_MODEL_PATH,
    defaultAllowRemoteModels: DEFAULT_CHAT_ALLOW_REMOTE_MODELS,
    defaultSetupAllowsRemoteModels: DEFAULT_CHAT_SETUP_ALLOW_REMOTE_MODELS,
    defaultMaxNewTokens: DEFAULT_CHAT_MAX_NEW_TOKENS,
    defaultContextCharLimit: DEFAULT_CHAT_CONTEXT_CHAR_LIMIT,
    ...runtimeInspection,
    manifestExists: inspection.manifestExists,
    manifestValid: inspection.manifestValid,
    modelFileExists: inspection.modelFileExists,
    modelSizeValid: inspection.modelSizeValid,
    modelHashValid: inspection.modelHashValid,
    localModelPathExists: existsSync(paths.profileDirectory),
    modelReady,
    ready: runtimeInspection.nodeLlamaAvailable && modelReady,
    modelPath: paths.profileDirectory,
    modelFile: paths.modelFile,
    manifestPath: paths.manifestPath,
    ollamaRequired: false,
    pythonRequired: false,
    storesRawPrompts: false,
    exposesThoughtText: false,
  }
}

export function modelCacheExists(
  cwd = process.cwd(),
  profile: ChatModelProfile = DEFAULT_CHAT_PROFILE,
  modelPath = process.env.RAGMIR_CHAT_MODEL_PATH ?? DEFAULT_CHAT_MODEL_PATH,
): boolean {
  const definition = chatModelDefinition(profile)
  const paths = resolveChatModelPaths(path.resolve(cwd), modelPath, profile)
  if (!existsSync(paths.manifestPath) || !existsSync(paths.modelFile)) return false
  try {
    return statSync(paths.modelFile).size === definition.bytes
  } catch {
    return false
  }
}

function resolveProfile(profile?: ChatModelProfile): ChatModelProfile {
  return chatModelProfile(profile ?? process.env.RAGMIR_CHAT_PROFILE ?? DEFAULT_CHAT_PROFILE)
}

export * from "./generation.js"
export * from "./profiles.js"
export * from "./runtime.js"
export * from "./server.js"
export type * from "./types.js"

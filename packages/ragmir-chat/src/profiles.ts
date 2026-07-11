import { createHash } from "node:crypto"
import { createReadStream, existsSync } from "node:fs"
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import type {
  ChatModelManifest,
  ChatModelProfile,
  ChatModelProfileDefinition,
  ModelFileResolver,
  SetupChatModelOptions,
  SetupChatModelResult,
} from "./types.js"

export const NODE_LLAMA_RUNTIME_VERSION = "3.19.0" as const
export const DEFAULT_CHAT_PROFILE: ChatModelProfile = "fast"
export const DEFAULT_CHAT_MODEL_PATH = ".ragmir/models/chat"
export const CHAT_MODEL_MANIFEST_FILE = "manifest.json"

export const CHAT_MODEL_PROFILES = {
  lite: {
    profile: "lite",
    family: "qwen2",
    modelId: "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
    revision: "9217f5db79a29953eb74d5343926648285ec7e67",
    fileName: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
    bytes: 491_400_032,
    sha256: "74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db",
    modelUri:
      "hf:Qwen/Qwen2.5-0.5B-Instruct-GGUF/qwen2.5-0.5b-instruct-q4_k_m.gguf#9217f5db79a29953eb74d5343926648285ec7e67",
    downloadUrl:
      "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/9217f5db79a29953eb74d5343926648285ec7e67/qwen2.5-0.5b-instruct-q4_k_m.gguf",
    sourceUrl: "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF",
    license: "Apache-2.0",
    licenseUrl:
      "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/blob/9217f5db79a29953eb74d5343926648285ec7e67/LICENSE",
    contextSize: 4_096,
    maxGenerationTokens: 512,
    defaultMaxNewTokens: 256,
    defaultContextCharLimit: 4_000,
    supportsThinking: false,
    temperature: 0.2,
    topP: 0.8,
    topK: 20,
    repeatPenalty: 1.15,
    seed: 42,
  },
  fast: {
    profile: "fast",
    family: "gemma4",
    modelId: "google/gemma-4-E2B-it-qat-q4_0-gguf",
    revision: "69536a21d70340464240401ba38223d805f6a709",
    fileName: "gemma-4-E2B_q4_0-it.gguf",
    bytes: 3_349_514_112,
    sha256: "3646b4c147cd235a44d91df1546d3b7d8e29b547dbe4e1f80856419aa455e6fd",
    modelUri:
      "hf:google/gemma-4-E2B-it-qat-q4_0-gguf/gemma-4-E2B_q4_0-it.gguf#69536a21d70340464240401ba38223d805f6a709",
    downloadUrl:
      "https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf/resolve/69536a21d70340464240401ba38223d805f6a709/gemma-4-E2B_q4_0-it.gguf",
    sourceUrl: "https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf",
    license: "Apache-2.0",
    licenseUrl: "https://ai.google.dev/gemma/apache_2",
    contextSize: 8_192,
    maxGenerationTokens: 2_048,
    defaultMaxNewTokens: 512,
    defaultContextCharLimit: 8_000,
    supportsThinking: true,
    temperature: 1,
    topP: 0.95,
    topK: 64,
  },
  quality: {
    profile: "quality",
    family: "gemma4",
    modelId: "google/gemma-4-E4B-it-qat-q4_0-gguf",
    revision: "7edc6763a77bbca236126a361613b834c5ea0f7a",
    fileName: "gemma-4-E4B_q4_0-it.gguf",
    bytes: 5_154_939_136,
    sha256: "e8b6a059ba86947a44ace84d6e5679795bc41862c25c30513142588f0e9dba1d",
    modelUri:
      "hf:google/gemma-4-E4B-it-qat-q4_0-gguf/gemma-4-E4B_q4_0-it.gguf#7edc6763a77bbca236126a361613b834c5ea0f7a",
    downloadUrl:
      "https://huggingface.co/google/gemma-4-E4B-it-qat-q4_0-gguf/resolve/7edc6763a77bbca236126a361613b834c5ea0f7a/gemma-4-E4B_q4_0-it.gguf",
    sourceUrl: "https://huggingface.co/google/gemma-4-E4B-it-qat-q4_0-gguf",
    license: "Apache-2.0",
    licenseUrl: "https://ai.google.dev/gemma/apache_2",
    contextSize: 8_192,
    maxGenerationTokens: 2_048,
    defaultMaxNewTokens: 512,
    defaultContextCharLimit: 8_000,
    supportsThinking: true,
    temperature: 1,
    topP: 0.95,
    topK: 64,
  },
} satisfies Record<ChatModelProfile, ChatModelProfileDefinition>

export interface ChatModelPaths {
  modelRoot: string
  profileDirectory: string
  modelFile: string
  manifestPath: string
}

export interface ChatModelInspection {
  manifestExists: boolean
  manifestValid: boolean
  modelFileExists: boolean
  modelSizeValid: boolean
  modelHashValid: boolean | null
  ready: boolean
  manifest: ChatModelManifest | null
}

export function chatModelProfile(value: unknown): ChatModelProfile {
  if (value === "lite" || value === "fast" || value === "quality") {
    return value
  }
  throw new Error("Chat profile must be `lite`, `fast`, or `quality`.")
}

export function chatModelDefinition(profile: ChatModelProfile): ChatModelProfileDefinition {
  return CHAT_MODEL_PROFILES[profile]
}

export function resolveChatModelPaths(
  cwd: string,
  modelPath: string,
  profile: ChatModelProfile,
): ChatModelPaths {
  const modelRoot = path.isAbsolute(modelPath) ? modelPath : path.resolve(cwd, modelPath)
  const profileDirectory = path.join(modelRoot, profile)
  const definition = chatModelDefinition(profile)
  return {
    modelRoot,
    profileDirectory,
    modelFile: path.join(profileDirectory, definition.fileName),
    manifestPath: path.join(profileDirectory, CHAT_MODEL_MANIFEST_FILE),
  }
}

export async function inspectChatModel(
  paths: ChatModelPaths,
  definition: ChatModelProfileDefinition,
  options: { verifyHash?: boolean } = {},
): Promise<ChatModelInspection> {
  const manifestExists = existsSync(paths.manifestPath)
  const manifest = manifestExists ? await readChatModelManifest(paths.manifestPath) : null
  const manifestValid = manifest !== null && manifestMatchesDefinition(manifest, definition)
  const modelFileExists = existsSync(paths.modelFile)
  const modelSizeValid = modelFileExists
    ? (await stat(paths.modelFile)).size === definition.bytes
    : false
  const modelHashValid =
    options.verifyHash === true && modelSizeValid
      ? (await sha256File(paths.modelFile)) === definition.sha256
      : null

  return {
    manifestExists,
    manifestValid,
    modelFileExists,
    modelSizeValid,
    modelHashValid,
    ready: manifestValid && modelFileExists && modelSizeValid && modelHashValid !== false,
    manifest,
  }
}

export async function setupChatModelFiles(
  options: SetupChatModelOptions,
  defaults: {
    cwd: string
    profile: ChatModelProfile
    modelPath: string
    allowRemoteModels: boolean
  },
): Promise<SetupChatModelResult> {
  const definition = chatModelDefinition(defaults.profile)
  const paths = resolveChatModelPaths(defaults.cwd, defaults.modelPath, defaults.profile)
  await mkdir(paths.profileDirectory, { recursive: true })

  const before = await inspectChatModel(paths, definition)
  if (before.modelFileExists && before.modelSizeValid) {
    const digest = await sha256File(paths.modelFile)
    if (digest === definition.sha256) {
      await writeChatModelManifest(paths.manifestPath, definition)
      return setupResult(paths, definition, defaults.allowRemoteModels, false)
    }
  }

  if (before.modelFileExists) {
    await rm(paths.modelFile, { force: true })
  }

  if (!defaults.allowRemoteModels) {
    throw new Error(
      `Local chat profile ${defaults.profile} is not verified locally. Run \`rgr-chat setup --profile ${defaults.profile}\` while online first.`,
    )
  }

  const resolver = options.resolveModel ?? defaultModelResolver
  const resolverOptions: Parameters<ModelFileResolver>[1] = {
    directory: paths.profileDirectory,
    fileName: definition.fileName,
    download: "auto",
    verify: true,
    cli: false,
  }
  if (options.signal !== undefined) {
    resolverOptions.signal = options.signal
  }
  if (options.onProgress !== undefined) {
    resolverOptions.onProgress = options.onProgress
  }

  const resolvedFile = path.resolve(await resolver(definition.modelUri, resolverOptions))
  if (resolvedFile !== path.resolve(paths.modelFile)) {
    throw new Error(`Model resolver returned an unexpected file: ${resolvedFile}`)
  }

  await verifyChatModelFile(paths.modelFile, definition)
  await writeChatModelManifest(paths.manifestPath, definition)

  return setupResult(paths, definition, defaults.allowRemoteModels, true)
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256")
  const stream = createReadStream(filePath)
  for await (const chunk of stream) {
    if (typeof chunk === "string" || Buffer.isBuffer(chunk)) {
      hash.update(chunk)
    }
  }
  return hash.digest("hex")
}

async function defaultModelResolver(
  modelUri: string,
  options: Parameters<ModelFileResolver>[1],
): Promise<string> {
  const { resolveModelFile } = await import("node-llama-cpp")
  return resolveModelFile(modelUri, options)
}

async function readChatModelManifest(manifestPath: string): Promise<ChatModelManifest | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"))
    return isChatModelManifest(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function verifyChatModelFile(
  modelFile: string,
  definition: ChatModelProfileDefinition,
): Promise<void> {
  const fileStat = await stat(modelFile)
  if (fileStat.size !== definition.bytes) {
    await rm(modelFile, { force: true })
    throw new Error(
      `Downloaded model size mismatch: expected ${definition.bytes}, received ${fileStat.size}.`,
    )
  }

  const digest = await sha256File(modelFile)
  if (digest !== definition.sha256) {
    await rm(modelFile, { force: true })
    throw new Error(
      `Downloaded model checksum mismatch: expected ${definition.sha256}, received ${digest}.`,
    )
  }
}

function modelManifest(definition: ChatModelProfileDefinition): ChatModelManifest {
  return {
    schemaVersion: 1,
    provider: "node-llama-cpp",
    runtimeVersion: NODE_LLAMA_RUNTIME_VERSION,
    profile: definition.profile,
    modelId: definition.modelId,
    revision: definition.revision,
    modelUri: definition.modelUri,
    downloadUrl: definition.downloadUrl,
    sourceUrl: definition.sourceUrl,
    license: definition.license,
    licenseUrl: definition.licenseUrl,
    fileName: definition.fileName,
    bytes: definition.bytes,
    sha256: definition.sha256,
    verifiedAt: new Date().toISOString(),
  }
}

async function writeChatModelManifest(
  manifestPath: string,
  definition: ChatModelProfileDefinition,
): Promise<void> {
  const temporaryManifest = `${manifestPath}.${process.pid}.tmp`
  await writeFile(
    temporaryManifest,
    `${JSON.stringify(modelManifest(definition), null, 2)}\n`,
    "utf8",
  )
  await rename(temporaryManifest, manifestPath)
}

function setupResult(
  paths: ChatModelPaths,
  definition: ChatModelProfileDefinition,
  allowRemoteModels: boolean,
  downloaded: boolean,
): SetupChatModelResult {
  return {
    provider: "node-llama-cpp",
    profile: definition.profile,
    model: definition.modelId,
    modelPath: paths.profileDirectory,
    modelFile: paths.modelFile,
    manifestPath: paths.manifestPath,
    allowRemoteModels,
    downloaded,
    verified: true,
    bytes: definition.bytes,
    sha256: definition.sha256,
    ready: true,
  }
}

function manifestMatchesDefinition(
  manifest: ChatModelManifest,
  definition: ChatModelProfileDefinition,
): boolean {
  return (
    manifest.profile === definition.profile &&
    manifest.modelId === definition.modelId &&
    manifest.revision === definition.revision &&
    manifest.modelUri === definition.modelUri &&
    manifest.downloadUrl === definition.downloadUrl &&
    manifest.sourceUrl === definition.sourceUrl &&
    manifest.license === definition.license &&
    manifest.licenseUrl === definition.licenseUrl &&
    manifest.fileName === definition.fileName &&
    manifest.bytes === definition.bytes &&
    manifest.sha256 === definition.sha256
  )
}

function isChatModelManifest(value: unknown): value is ChatModelManifest {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    value.provider === "node-llama-cpp" &&
    value.runtimeVersion === NODE_LLAMA_RUNTIME_VERSION &&
    (value.profile === "lite" || value.profile === "fast" || value.profile === "quality") &&
    typeof value.modelId === "string" &&
    typeof value.revision === "string" &&
    typeof value.modelUri === "string" &&
    typeof value.downloadUrl === "string" &&
    typeof value.sourceUrl === "string" &&
    value.license === "Apache-2.0" &&
    typeof value.licenseUrl === "string" &&
    typeof value.fileName === "string" &&
    typeof value.bytes === "number" &&
    typeof value.sha256 === "string" &&
    typeof value.verifiedAt === "string"
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

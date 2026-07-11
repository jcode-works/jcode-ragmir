export type ChatRole = "system" | "user" | "assistant"

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface ChatHistoryMessage {
  role: "user" | "assistant"
  content: string
}

export interface ChatSource {
  source?: string
  relativePath: string
  chunkIndex: number
  text: string
  distance?: number | null
}

export type ChatModelProfile = "lite" | "fast" | "quality"
export type ChatModelFamily = "gemma4" | "qwen2"
export type ChatThinkingMode = "off" | "standard" | "deep"
export type ChatComputeBackend = "metal" | "cuda" | "vulkan" | "cpu"
export type ChatCitationStatus = "none" | "missing" | "valid" | "partial" | "invalid"
export type ChatStopReason =
  | "abort"
  | "customStopTrigger"
  | "eogToken"
  | "functionCalls"
  | "maxTokens"
  | "stopGenerationTrigger"

export interface ChatModelProfileDefinition {
  profile: ChatModelProfile
  family: ChatModelFamily
  modelId: string
  revision: string
  fileName: string
  bytes: number
  sha256: string
  modelUri: string
  downloadUrl: string
  sourceUrl: string
  license: "Apache-2.0"
  licenseUrl: string
  contextSize: number
  maxGenerationTokens: number
  defaultMaxNewTokens: number
  defaultContextCharLimit: number
  supportsThinking: boolean
  temperature: number
  topP: number
  topK: number
  repeatPenalty?: number
  seed?: number
}

export interface ChatModelManifest {
  schemaVersion: 1
  provider: "node-llama-cpp"
  runtimeVersion: "3.19.0"
  profile: ChatModelProfile
  modelId: string
  revision: string
  modelUri: string
  downloadUrl: string
  sourceUrl: string
  license: "Apache-2.0"
  licenseUrl: string
  fileName: string
  bytes: number
  sha256: string
  verifiedAt: string
}

export type ChatGenerationEvent =
  | {
      type: "loading"
      active: boolean
      profile: ChatModelProfile
      model: string
    }
  | {
      type: "reasoning"
      active: boolean
      thoughtTokens: number
    }
  | {
      type: "delta"
      text: string
    }

export interface ChatRuntimeGenerationOptions {
  messages: ChatMessage[]
  thinking: ChatThinkingMode
  maxNewTokens: number
  signal?: AbortSignal
  onEvent?: (event: ChatGenerationEvent) => void
}

export interface ChatRuntimeGenerationResult {
  answer: string
  stopReason: ChatStopReason
  thoughtTokens: number
}

export interface ChatRuntime {
  generate(options: ChatRuntimeGenerationOptions): Promise<ChatRuntimeGenerationResult>
  cancel(reason?: unknown): void
  dispose(): Promise<void>
}

export interface GenerateChatAnswerOptions {
  cwd?: string
  question: string
  sources?: ChatSource[]
  history?: ChatHistoryMessage[]
  profile?: ChatModelProfile
  thinking?: ChatThinkingMode
  modelPath?: string
  allowRemoteModels?: boolean
  maxNewTokens?: number
  contextCharLimit?: number
  systemPrompt?: string
  signal?: AbortSignal
  onEvent?: (event: ChatGenerationEvent) => void
  runtime?: ChatRuntime
}

export interface GenerateChatAnswerResult {
  question: string
  answer: string
  sources: ChatSource[]
  provider: "node-llama-cpp"
  profile: ChatModelProfile
  thinking: ChatThinkingMode
  model: string
  modelPath: string
  allowRemoteModels: false
  maxNewTokens: number
  contextCharLimit: number
  emptyContext: boolean
  citationStatus: ChatCitationStatus
  citations: number[]
  invalidCitations: number[]
  stopReason: ChatStopReason | null
  thoughtTokens: number
}

export interface SetupChatModelOptions {
  cwd?: string
  profile?: ChatModelProfile
  modelPath?: string
  allowRemoteModels?: boolean
  signal?: AbortSignal
  onProgress?: (progress: { totalSize: number; downloadedSize: number }) => void
  resolveModel?: ModelFileResolver
}

export type ModelFileResolver = (
  modelUri: string,
  options: {
    directory: string
    fileName: string
    download: "auto" | false
    verify: boolean
    cli: boolean
    signal?: AbortSignal
    onProgress?: (progress: { totalSize: number; downloadedSize: number }) => void
  },
) => Promise<string>

export interface SetupChatModelResult {
  provider: "node-llama-cpp"
  profile: ChatModelProfile
  model: string
  modelPath: string
  modelFile: string
  manifestPath: string
  allowRemoteModels: boolean
  downloaded: boolean
  verified: true
  bytes: number
  sha256: string
  ready: true
}

export interface DoctorOptions {
  cwd?: string
  profile?: ChatModelProfile
  modelPath?: string
  verifyHash?: boolean
}

export interface DoctorReport {
  node: string
  provider: "node-llama-cpp"
  runtimeVersion: "3.19.0"
  profile: ChatModelProfile
  defaultProfile: ChatModelProfile
  defaultModel: string
  defaultModelPath: string
  defaultAllowRemoteModels: false
  defaultSetupAllowsRemoteModels: true
  defaultMaxNewTokens: number
  defaultContextCharLimit: number
  nodeLlamaAvailable: boolean
  platform: string
  arch: string
  supportedBackends: ChatComputeBackend[]
  selectedBackend: ChatComputeBackend | null
  hardwareAcceleration: boolean
  manifestExists: boolean
  manifestValid: boolean
  modelFileExists: boolean
  modelSizeValid: boolean
  modelHashValid: boolean | null
  localModelPathExists: boolean
  modelReady: boolean
  ready: boolean
  modelPath: string
  modelFile: string
  manifestPath: string
  ollamaRequired: false
  pythonRequired: false
  storesRawPrompts: false
  exposesThoughtText: false
}

export interface ChatRuntimeInspection {
  nodeLlamaAvailable: boolean
  platform: string
  arch: string
  supportedBackends: ChatComputeBackend[]
  selectedBackend: ChatComputeBackend | null
  hardwareAcceleration: boolean
}

export interface CitationValidationResult {
  answer: string
  status: ChatCitationStatus
  citations: number[]
  invalidCitations: number[]
}

import { Channel, invoke } from "@tauri-apps/api/core"
import type { SearchResult } from "./ragmir-sidecar.js"

export type ChatProfile = "lite" | "fast" | "quality"
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

export interface ChatHistoryMessage {
  role: "user" | "assistant"
  content: string
}

export interface ChatGenerateRequest {
  projectRoot: string
  id: string
  question: string
  history: ChatHistoryMessage[]
  sources: SearchResult[]
  profile: ChatProfile
  thinking: ChatThinkingMode
  maxNewTokens?: number
  contextCharLimit?: number
}

export interface ChatResult {
  question: string
  answer: string
  sources: SearchResult[]
  provider: "node-llama-cpp"
  profile: ChatProfile
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

export type ChatRuntimeEvent =
  | {
      id: string
      event: "loading"
      active: boolean
      profile: ChatProfile
      model: string
    }
  | {
      id: string
      event: "reasoning"
      active: boolean
      thoughtTokens: number
    }
  | {
      id: string
      event: "delta"
      text: string
    }
  | {
      id: string
      event: "completed"
      result: ChatResult
    }
  | {
      id: string
      event: "cancelled"
      partialAnswer: string
    }
  | {
      id: string
      event: "error"
      code: string
      message: string
    }

export type ChatTerminalEvent = Extract<
  ChatRuntimeEvent,
  { event: "completed" | "cancelled" | "error" }
>

export interface ChatSetupResult {
  provider: "node-llama-cpp"
  profile: ChatProfile
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

export interface ChatDoctorReport {
  node: string
  provider: "node-llama-cpp"
  runtimeVersion: "3.19.0"
  profile: ChatProfile
  defaultProfile: ChatProfile
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

export async function generateRagmirChat(
  request: ChatGenerateRequest,
  onEvent: (event: ChatRuntimeEvent) => void,
): Promise<ChatTerminalEvent> {
  return new Promise((resolve, reject) => {
    let settled = false
    const channel = new Channel<unknown>()
    channel.onmessage = (value) => {
      if (settled) {
        return
      }
      const event = readChatRuntimeEvent(value)
      if (!event || event.id !== request.id) {
        settled = true
        void cancelRagmirChat(request.id).catch(() => undefined)
        reject(new Error("The local chat runtime returned an invalid streaming event."))
        return
      }
      onEvent(event)
      if (isTerminalEvent(event)) {
        settled = true
        resolve(event)
      }
    }

    invoke<void>("generate_ragmir_chat", { request, onEvent: channel }).catch((error: unknown) => {
      if (!settled) {
        settled = true
        reject(toError(error, "Unable to start the local chat runtime."))
      }
    })
  })
}

export async function cancelRagmirChat(targetId: string): Promise<void> {
  await invoke<void>("cancel_ragmir_chat", {
    request: {
      id: localRequestId("cancel"),
      targetId,
    },
  })
}

export async function shutdownRagmirChat(): Promise<void> {
  await invoke<void>("shutdown_ragmir_chat")
}

export async function setupRagmirChat(
  projectRoot: string,
  profile: ChatProfile,
): Promise<ChatSetupResult> {
  const value = await invoke<unknown>("setup_ragmir_chat", {
    request: { projectRoot, profile },
  })
  if (!isChatSetupResult(value)) {
    throw new Error("Ragmir Chat returned an invalid local model setup result.")
  }
  return value
}

export async function doctorRagmirChat(
  projectRoot: string,
  profile: ChatProfile,
): Promise<ChatDoctorReport> {
  const value = await invoke<unknown>("doctor_ragmir_chat", {
    request: { projectRoot, profile },
  })
  if (!isChatDoctorReport(value)) {
    throw new Error("Ragmir Chat returned an invalid local model doctor report.")
  }
  return value
}

function readChatRuntimeEvent(value: unknown): ChatRuntimeEvent | null {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null
  }
  if (
    value.event === "loading" &&
    typeof value.active === "boolean" &&
    isChatProfile(value.profile) &&
    typeof value.model === "string"
  ) {
    return {
      id: value.id,
      event: value.event,
      active: value.active,
      profile: value.profile,
      model: value.model,
    }
  }
  if (
    value.event === "reasoning" &&
    typeof value.active === "boolean" &&
    typeof value.thoughtTokens === "number"
  ) {
    return {
      id: value.id,
      event: value.event,
      active: value.active,
      thoughtTokens: value.thoughtTokens,
    }
  }
  if (value.event === "delta" && typeof value.text === "string") {
    return { id: value.id, event: value.event, text: value.text }
  }
  if (value.event === "completed" && isChatResult(value.result)) {
    return { id: value.id, event: value.event, result: value.result }
  }
  if (value.event === "cancelled" && typeof value.partialAnswer === "string") {
    return { id: value.id, event: value.event, partialAnswer: value.partialAnswer }
  }
  if (
    value.event === "error" &&
    typeof value.code === "string" &&
    typeof value.message === "string"
  ) {
    return { id: value.id, event: value.event, code: value.code, message: value.message }
  }
  return null
}

function isTerminalEvent(event: ChatRuntimeEvent): event is ChatTerminalEvent {
  return event.event === "completed" || event.event === "cancelled" || event.event === "error"
}

function isChatResult(value: unknown): value is ChatResult {
  return (
    isRecord(value) &&
    typeof value.question === "string" &&
    typeof value.answer === "string" &&
    Array.isArray(value.sources) &&
    value.sources.every(isSearchResult) &&
    value.provider === "node-llama-cpp" &&
    isChatProfile(value.profile) &&
    isChatThinkingMode(value.thinking) &&
    typeof value.model === "string" &&
    typeof value.modelPath === "string" &&
    value.allowRemoteModels === false &&
    typeof value.maxNewTokens === "number" &&
    typeof value.contextCharLimit === "number" &&
    typeof value.emptyContext === "boolean" &&
    isChatCitationStatus(value.citationStatus) &&
    isNumberArray(value.citations) &&
    isNumberArray(value.invalidCitations) &&
    (value.stopReason === null || isChatStopReason(value.stopReason)) &&
    typeof value.thoughtTokens === "number"
  )
}

function isChatSetupResult(value: unknown): value is ChatSetupResult {
  return (
    isRecord(value) &&
    value.provider === "node-llama-cpp" &&
    isChatProfile(value.profile) &&
    typeof value.model === "string" &&
    typeof value.modelPath === "string" &&
    typeof value.modelFile === "string" &&
    typeof value.manifestPath === "string" &&
    typeof value.allowRemoteModels === "boolean" &&
    typeof value.downloaded === "boolean" &&
    value.verified === true &&
    typeof value.bytes === "number" &&
    typeof value.sha256 === "string" &&
    value.ready === true
  )
}

function isChatDoctorReport(value: unknown): value is ChatDoctorReport {
  return (
    isRecord(value) &&
    typeof value.node === "string" &&
    value.provider === "node-llama-cpp" &&
    value.runtimeVersion === "3.19.0" &&
    isChatProfile(value.profile) &&
    isChatProfile(value.defaultProfile) &&
    typeof value.defaultModel === "string" &&
    typeof value.defaultModelPath === "string" &&
    value.defaultAllowRemoteModels === false &&
    value.defaultSetupAllowsRemoteModels === true &&
    typeof value.defaultMaxNewTokens === "number" &&
    typeof value.defaultContextCharLimit === "number" &&
    typeof value.nodeLlamaAvailable === "boolean" &&
    typeof value.platform === "string" &&
    typeof value.arch === "string" &&
    Array.isArray(value.supportedBackends) &&
    value.supportedBackends.every(isChatComputeBackend) &&
    (value.selectedBackend === null || isChatComputeBackend(value.selectedBackend)) &&
    typeof value.hardwareAcceleration === "boolean" &&
    typeof value.manifestExists === "boolean" &&
    typeof value.manifestValid === "boolean" &&
    typeof value.modelFileExists === "boolean" &&
    typeof value.modelSizeValid === "boolean" &&
    (typeof value.modelHashValid === "boolean" || value.modelHashValid === null) &&
    typeof value.localModelPathExists === "boolean" &&
    typeof value.modelReady === "boolean" &&
    typeof value.ready === "boolean" &&
    typeof value.modelPath === "string" &&
    typeof value.modelFile === "string" &&
    typeof value.manifestPath === "string" &&
    value.ollamaRequired === false &&
    value.pythonRequired === false &&
    value.storesRawPrompts === false &&
    value.exposesThoughtText === false
  )
}

function isSearchResult(value: unknown): value is SearchResult {
  return (
    isRecord(value) &&
    typeof value.source === "string" &&
    typeof value.relativePath === "string" &&
    typeof value.chunkIndex === "number" &&
    typeof value.text === "string" &&
    (typeof value.distance === "number" || value.distance === null)
  )
}

function isChatProfile(value: unknown): value is ChatProfile {
  return value === "lite" || value === "fast" || value === "quality"
}

function isChatComputeBackend(value: unknown): value is ChatComputeBackend {
  return value === "metal" || value === "cuda" || value === "vulkan" || value === "cpu"
}

function isChatThinkingMode(value: unknown): value is ChatThinkingMode {
  return value === "off" || value === "standard" || value === "deep"
}

function isChatCitationStatus(value: unknown): value is ChatCitationStatus {
  return (
    value === "none" ||
    value === "missing" ||
    value === "valid" ||
    value === "partial" ||
    value === "invalid"
  )
}

function isChatStopReason(value: unknown): value is ChatStopReason {
  return (
    value === "abort" ||
    value === "customStopTrigger" ||
    value === "eogToken" ||
    value === "functionCalls" ||
    value === "maxTokens" ||
    value === "stopGenerationTrigger"
  )
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "number")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function localRequestId(prefix: string): string {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${id}`
}

function toError(value: unknown, fallback: string): Error {
  if (value instanceof Error) {
    return value
  }
  return new Error(typeof value === "string" && value.trim() ? value : fallback)
}

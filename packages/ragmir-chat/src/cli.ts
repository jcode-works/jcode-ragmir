#!/usr/bin/env node
import { readFile } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"
import {
  type ChatHistoryMessage,
  type ChatModelProfile,
  type ChatThinkingMode,
  chatModelProfile,
  type DoctorOptions,
  doctor,
  type GenerateChatAnswerOptions,
  generateChatAnswer,
  type SetupChatModelOptions,
  serveChat,
  setupChatModel,
} from "./index.js"

type CliValues = Record<string, string | boolean | undefined>

const DEPRECATED_CLI_NAME = "ragmir-chat"
const PUBLIC_CLI_NAME = "rgr-chat"

if (isDeprecatedCliInvocation()) {
  console.error(
    `The \`${DEPRECATED_CLI_NAME}\` CLI command is deprecated and will be removed in a future release. Use \`${PUBLIC_CLI_NAME}\` instead.`,
  )
}

const command = process.argv[2]

try {
  if (command === "doctor") {
    await runDoctor(process.argv.slice(3))
  } else if (command === "setup") {
    await runSetup(process.argv.slice(3))
  } else if (command === "answer") {
    await runAnswer(process.argv.slice(3))
  } else if (command === "serve") {
    await runServe(process.argv.slice(3))
  } else {
    printHelp()
    process.exitCode = command ? 1 : 0
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}

async function runDoctor(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      profile: { type: "string" },
      "model-path": { type: "string" },
      verify: { type: "boolean" },
      json: { type: "boolean" },
    },
  })
  const options: DoctorOptions = {}
  const profile = profileValue(values)
  const modelPath = stringValue(values, "model-path")
  if (profile !== undefined) options.profile = profile
  if (modelPath !== undefined) options.modelPath = modelPath
  if (values.verify === true) options.verifyHash = true
  printMaybeJson(await doctor(options), values.json === true)
}

async function runSetup(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      profile: { type: "string" },
      "model-path": { type: "string" },
      offline: { type: "boolean" },
      json: { type: "boolean" },
    },
  })
  const options: SetupChatModelOptions = {}
  const profile = profileValue(values)
  const modelPath = stringValue(values, "model-path")
  if (profile !== undefined) options.profile = profile
  if (modelPath !== undefined) options.modelPath = modelPath
  if (values.offline === true) options.allowRemoteModels = false
  let lastProgress = -1
  let wroteProgress = false
  if (values.json !== true && values.offline !== true) {
    options.onProgress = ({ totalSize, downloadedSize }) => {
      if (totalSize <= 0) return
      const progress = Math.min(100, Math.floor((downloadedSize / totalSize) * 100))
      if (progress === lastProgress) return
      lastProgress = progress
      wroteProgress = true
      process.stderr.write(`\rDownloading verified local chat weights: ${progress}%`)
    }
  }
  const result = await setupChatModel(options).finally(() => {
    if (wroteProgress) process.stderr.write("\n")
  })
  printMaybeJson(result, values.json === true)
}

async function runAnswer(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      context: { type: "string", short: "c" },
      history: { type: "string" },
      profile: { type: "string" },
      thinking: { type: "string" },
      "model-path": { type: "string" },
      offline: { type: "boolean" },
      "max-new-tokens": { type: "string" },
      "context-limit": { type: "string" },
      json: { type: "boolean" },
    },
  })
  const question = positionals.join(" ").trim()
  if (!question) {
    throw new Error(`usage: ${PUBLIC_CLI_NAME} answer <question> --context context.txt`)
  }

  const contextPath = stringValue(values, "context")
  const options: GenerateChatAnswerOptions = {
    question,
    sources: contextPath
      ? [
          {
            relativePath: path.basename(contextPath),
            chunkIndex: 0,
            text: await readFile(contextPath, "utf8"),
          },
        ]
      : [],
  }
  const historyPath = stringValue(values, "history")
  const profile = profileValue(values)
  const thinking = thinkingValue(values)
  const modelPath = stringValue(values, "model-path")
  const maxNewTokens = positiveIntValue(values, "max-new-tokens")
  const contextCharLimit = positiveIntValue(values, "context-limit")
  if (historyPath !== undefined) options.history = await readHistory(historyPath)
  if (profile !== undefined) options.profile = profile
  if (thinking !== undefined) options.thinking = thinking
  if (modelPath !== undefined) options.modelPath = modelPath
  if (maxNewTokens !== undefined) options.maxNewTokens = maxNewTokens
  if (contextCharLimit !== undefined) options.contextCharLimit = contextCharLimit

  const result = await generateChatAnswer(options)
  if (values.json === true) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  console.log(result.answer)
}

async function runServe(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      profile: { type: "string" },
      "model-path": { type: "string" },
      offline: { type: "boolean" },
    },
  })
  const options: Parameters<typeof serveChat>[0] = {}
  const profile = profileValue(values)
  const modelPath = stringValue(values, "model-path")
  if (profile !== undefined) options.profile = profile
  if (modelPath !== undefined) options.modelPath = modelPath
  await serveChat(options)
}

async function readHistory(filePath: string): Promise<ChatHistoryMessage[]> {
  const value: unknown = JSON.parse(await readFile(filePath, "utf8"))
  if (
    !Array.isArray(value) ||
    !value.every(
      (message) =>
        typeof message === "object" &&
        message !== null &&
        "role" in message &&
        (message.role === "user" || message.role === "assistant") &&
        "content" in message &&
        typeof message.content === "string",
    )
  ) {
    throw new Error("History file must contain user/assistant message objects.")
  }
  return value
}

function profileValue(values: CliValues): ChatModelProfile | undefined {
  const value = stringValue(values, "profile")
  return value === undefined ? undefined : chatModelProfile(value)
}

function thinkingValue(values: CliValues): ChatThinkingMode | undefined {
  const value = stringValue(values, "thinking")
  if (value === undefined) return undefined
  if (value === "off" || value === "standard" || value === "deep") return value
  throw new Error("Thinking mode must be `off`, `standard`, or `deep`.")
}

function stringValue(values: CliValues, key: string): string | undefined {
  const value = values[key]
  return typeof value === "string" ? value : undefined
}

function positiveIntValue(values: CliValues, key: string): number | undefined {
  const value = stringValue(values, key)
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer for --${key}.`)
  }
  return parsed
}

function printMaybeJson(value: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(value, null, 2))
    return
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      console.log(`${key}=${String(entry)}`)
    }
    return
  }
  console.log(String(value))
}

function printHelp(): void {
  console.log(`${PUBLIC_CLI_NAME}

Usage:
  ${PUBLIC_CLI_NAME} doctor [--profile lite|fast|quality] [--verify] [--json]
  ${PUBLIC_CLI_NAME} setup [--profile lite|fast|quality] [--model-path .ragmir/models/chat]
  ${PUBLIC_CLI_NAME} answer <question> --context context.txt [--thinking off|standard|deep]
  ${PUBLIC_CLI_NAME} serve [--profile lite|fast|quality] [--offline]

Options:
  --profile <profile>           Local model: lite (Qwen2.5 0.5B), fast (Gemma 4 E2B, default), or quality (Gemma 4 E4B).
  --model-path <path>           Model root. Defaults to .ragmir/models/chat.
  --offline                     Require an already verified local model.
  --verify                      Recompute the full model SHA256 during doctor.
  --thinking <mode>             Thinking mode: off, standard, or deep. Lite always uses off.
  --history <file>              JSON array of visible user/assistant messages.
  --max-new-tokens <number>     Maximum visible answer tokens. Lite defaults to 256 and caps at 512; Gemma defaults to 512.
  --context-limit <number>      Maximum evidence characters. Lite defaults to 4000; Gemma defaults to 8000.
  --json                        Print JSON output.
`)
}

function isDeprecatedCliInvocation(): boolean {
  const invokedPath = process.argv[1]
  if (!invokedPath) return false
  const commandName = path.basename(invokedPath).replace(/\.(?:cmd|ps1)$/iu, "")
  return commandName === DEPRECATED_CLI_NAME
}

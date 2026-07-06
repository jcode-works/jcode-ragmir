#!/usr/bin/env node
import { readFile } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"
import {
  type DoctorOptions,
  doctor,
  type GenerateChatAnswerOptions,
  generateChatAnswer,
  type SetupChatModelOptions,
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
      json: { type: "boolean" },
      "model-path": { type: "string" },
    },
  })
  const doctorOptions: DoctorOptions = {}
  addDoctorStringOption(doctorOptions, "modelPath", stringValue(values, "model-path"))
  const report = await doctor(doctorOptions)
  printMaybeJson(report, values.json === true)
}

async function runSetup(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      model: { type: "string" },
      "model-path": { type: "string" },
      offline: { type: "boolean" },
      dtype: { type: "string" },
      json: { type: "boolean" },
    },
  })
  const setupOptions: SetupChatModelOptions = {}
  addSetupStringOption(setupOptions, "model", stringValue(values, "model"))
  addSetupStringOption(setupOptions, "modelPath", stringValue(values, "model-path"))
  addSetupStringOption(setupOptions, "dtype", stringValue(values, "dtype"))
  addSetupBooleanOption(
    setupOptions,
    "allowRemoteModels",
    values.offline === true ? false : undefined,
  )
  const result = await setupChatModel(setupOptions)
  printMaybeJson(result, values.json === true)
}

async function runAnswer(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      context: { type: "string", short: "c" },
      model: { type: "string" },
      "model-path": { type: "string" },
      offline: { type: "boolean" },
      "allow-remote-models": { type: "boolean" },
      "max-new-tokens": { type: "string" },
      "context-limit": { type: "string" },
      dtype: { type: "string" },
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
  addStringOption(options, "model", stringValue(values, "model"))
  addStringOption(options, "modelPath", stringValue(values, "model-path"))
  addStringOption(options, "dtype", stringValue(values, "dtype"))
  addBooleanOption(options, "allowRemoteModels", allowRemoteModels(values))
  addNumberOption(options, "maxNewTokens", positiveIntValue(values, "max-new-tokens"))
  addNumberOption(options, "contextCharLimit", positiveIntValue(values, "context-limit"))

  const result = await generateChatAnswer(options)
  if (values.json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  console.log(result.answer)
}

function allowRemoteModels(values: CliValues): boolean | undefined {
  if (values.offline === true) {
    return false
  }
  if (values["allow-remote-models"] === true) {
    return true
  }
  return undefined
}

function stringValue(values: CliValues, key: string): string | undefined {
  const value = values[key]
  return typeof value === "string" ? value : undefined
}

function positiveIntValue(values: CliValues, key: string): number | undefined {
  const value = stringValue(values, key)
  if (value === undefined) {
    return undefined
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer for --${key}.`)
  }
  return parsed
}

function addStringOption(
  target: GenerateChatAnswerOptions,
  key: "model" | "modelPath" | "dtype",
  value: string | undefined,
): void {
  if (value !== undefined) {
    target[key] = value
  }
}

function addDoctorStringOption(
  target: DoctorOptions,
  key: "modelPath",
  value: string | undefined,
): void {
  if (value !== undefined) {
    target[key] = value
  }
}

function addSetupStringOption(
  target: SetupChatModelOptions,
  key: "model" | "modelPath" | "dtype",
  value: string | undefined,
): void {
  if (value !== undefined) {
    target[key] = value
  }
}

function addSetupBooleanOption(
  target: SetupChatModelOptions,
  key: "allowRemoteModels",
  value: boolean | undefined,
): void {
  if (value !== undefined) {
    target[key] = value
  }
}

function addBooleanOption(
  target: GenerateChatAnswerOptions,
  key: "allowRemoteModels",
  value: boolean | undefined,
): void {
  if (value !== undefined) {
    target[key] = value
  }
}

function addNumberOption(
  target: GenerateChatAnswerOptions,
  key: "maxNewTokens" | "contextCharLimit",
  value: number | undefined,
): void {
  if (value !== undefined) {
    target[key] = value
  }
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
  ${PUBLIC_CLI_NAME} doctor [--json]
  ${PUBLIC_CLI_NAME} setup [--model model-id] [--model-path .ragmir/models/chat]
  ${PUBLIC_CLI_NAME} answer <question> --context context.txt

Options:
  --model <id>                 Transformers.js text-generation model ID.
  --model-path <path>          Local model/cache path. Defaults to .ragmir/models/chat.
  --offline                    Disable remote model loading.
  --allow-remote-models        Explicitly allow remote model downloads for answer.
  --max-new-tokens <number>    Maximum generated tokens. Default 384.
  --context-limit <number>     Maximum context characters sent to the model. Default 8000.
  --dtype <dtype>              Transformers.js dtype. Default q4.
  --json                       Print JSON output.
`)
}

function isDeprecatedCliInvocation(): boolean {
  const invokedPath = process.argv[1]
  if (!invokedPath) return false

  const commandName = path.basename(invokedPath).replace(/\.(?:cmd|ps1)$/iu, "")
  return commandName === DEPRECATED_CLI_NAME
}

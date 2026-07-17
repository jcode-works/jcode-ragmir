import path from "node:path"
import { readBoundedStdin } from "./cli-stdin.js"
import { VERSION } from "./version.js"

const DEPRECATED_CLI_NAMES = new Set(["ragmir", "kb"])
const ROUTE_PROMPT_COMMAND = "route-prompt"

export interface FastCliIo {
  stdin: AsyncIterable<string | Uint8Array>
  stdout: (text: string) => void
  stderr: (text: string) => void
}

export type FastCliResult = { handled: false } | { handled: true; exitCode: 0 | 1 }

export async function runFastCli(
  argv: string[],
  invokedPath: string | undefined,
  io: FastCliIo = processIo(),
): Promise<FastCliResult> {
  const invocation = scanInvocation(argv)
  if (!invocation.fastEligible) {
    return { handled: false }
  }
  if (invocation.versionRequested) {
    printDeprecationWarning(invokedPath, io)
    io.stdout(`${VERSION}\n`)
    return { handled: true, exitCode: 0 }
  }

  if (invocation.commandIndex === -1 || argv[invocation.commandIndex] !== ROUTE_PROMPT_COMMAND) {
    return { handled: false }
  }

  printDeprecationWarning(invokedPath, io)
  const parsed = parseRoutePromptArguments(argv.slice(invocation.commandIndex + 1))
  if (parsed.help) {
    io.stdout(routePromptHelp())
    return { handled: true, exitCode: 0 }
  }

  const prompt =
    parsed.promptParts.length > 0 ? parsed.promptParts.join(" ") : await readBoundedStdin(io.stdin)
  if (prompt.trim().length === 0) {
    io.stderr("Missing prompt. Pass text or pipe it on stdin.\n")
    return { handled: true, exitCode: 1 }
  }

  const { routePrompt } = await import("./prompt-routing.js")
  const decision = routePrompt(prompt)
  if (parsed.json) {
    io.stdout(`${JSON.stringify(decision, null, 2)}\n`)
    return { handled: true, exitCode: 0 }
  }

  io.stdout(`shouldUseRagmir=${decision.shouldUseRagmir}\n`)
  io.stdout(`confidence=${decision.confidence.toFixed(2)}\n`)
  io.stdout(`tool=${decision.tool}\n`)
  if (decision.query !== null) {
    io.stdout(`query=${decision.query}\n`)
  }
  io.stdout(`reason=${decision.reason}\n`)
  if (decision.matchedSignals.length > 0) {
    io.stdout(`matchedSignals=${decision.matchedSignals.join(", ")}\n`)
  }
  return { handled: true, exitCode: 0 }
}

function scanInvocation(argv: string[]): {
  commandIndex: number
  fastEligible: boolean
  versionRequested: boolean
} {
  let versionRequested = false
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--project-root") {
      if (argv[index + 1] === undefined) {
        return { commandIndex: -1, fastEligible: false, versionRequested: false }
      }
      index += 1
      continue
    }
    if (argument?.startsWith("--project-root=")) {
      continue
    }
    if (argument === "--version" || argument === "-V") {
      versionRequested = true
      continue
    }
    if (argument?.startsWith("-")) {
      return { commandIndex: -1, fastEligible: false, versionRequested: false }
    }
    return { commandIndex: index, fastEligible: true, versionRequested }
  }
  return { commandIndex: -1, fastEligible: true, versionRequested }
}

function parseRoutePromptArguments(argv: string[]): {
  help: boolean
  json: boolean
  promptParts: string[]
} {
  const promptParts: string[] = []
  let help = false
  let json = false
  let literalArguments = false

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (literalArguments) {
      if (argument !== undefined) promptParts.push(argument)
      continue
    }
    if (argument === "--") {
      literalArguments = true
      continue
    }
    if (argument === "--json") {
      json = true
      continue
    }
    if (argument === "--help" || argument === "-h") {
      help = true
      continue
    }
    if (argument === "--project-root") {
      if (argv[index + 1] === undefined) {
        throw new Error("Option '--project-root <path>' argument missing")
      }
      index += 1
      continue
    }
    if (argument?.startsWith("--project-root=")) {
      continue
    }
    if (argument?.startsWith("-")) {
      throw new Error(`Unknown option '${argument}'`)
    }
    if (argument !== undefined) promptParts.push(argument)
  }

  return { help, json, promptParts }
}

function routePromptHelp(): string {
  return [
    "Usage: rgr route-prompt [options] [prompt...]",
    "",
    "Classify a prompt and suggest whether an agent should use Ragmir local context.",
    "",
    "Arguments:",
    "  prompt      Prompt text to classify. Reads bounded stdin when omitted.",
    "",
    "Options:",
    "  --json      Print machine-readable JSON.",
    "  -h, --help  display help for command",
    "",
  ].join("\n")
}

function printDeprecationWarning(invokedPath: string | undefined, io: FastCliIo): void {
  if (!invokedPath) return
  const commandName = path.basename(invokedPath).replace(/\.(?:cmd|ps1)$/iu, "")
  if (DEPRECATED_CLI_NAMES.has(commandName)) {
    io.stderr(
      `The \`${commandName}\` CLI command is deprecated and will be removed in a future release. Use \`rgr\` instead.\n`,
    )
  }
}

function processIo(): FastCliIo {
  return {
    stdin: process.stdin,
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  }
}

import { VERSION } from "./version.js"

export interface FastCliIo {
  stdout: (text: string) => void
}

export type FastCliResult = { handled: false } | { handled: true; exitCode: 0 | 1 }

export async function runFastCli(
  argv: string[],
  io: FastCliIo = processIo(),
): Promise<FastCliResult> {
  const invocation = scanInvocation(argv)
  if (!invocation.fastEligible) {
    return { handled: false }
  }
  if (invocation.versionRequested) {
    io.stdout(`${VERSION}\n`)
    return { handled: true, exitCode: 0 }
  }

  return { handled: false }
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

function processIo(): FastCliIo {
  return {
    stdout: (text) => process.stdout.write(text),
  }
}

import type { ReactNode } from "react"

/** Executables and agent slash commands that start a command line. */
const PROGRAMS = new Set([
  "npx",
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "bunx",
  "mise",
  "node",
  "rgr",
  "docker",
  "codex",
  "gemini",
  "qwen",
  "claude",
])

const TOKEN_PATTERN = /("[^"]*"?|'[^']*'?|\S+)(\s*)/gu

/**
 * Colours a shell command for display: the program in the accent colour, flags dimmed, quoted
 * globs and paths in a second hue, everything else in the foreground. Partial input (a command
 * still being typed) stays valid because each token is coloured on its own.
 */
export function highlightCommand(command: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let expectProgram = true
  let index = 0
  for (const match of command.matchAll(TOKEN_PATTERN)) {
    const [, token = "", space = ""] = match
    const className = tokenClass(token, expectProgram)
    nodes.push(
      <span className={className} key={index}>
        {token}
      </span>,
    )
    if (space) nodes.push(space)
    expectProgram = token === "&&" || token === "|" || token === ";"
    index += 1
  }
  return nodes
}

/** Tokens up to this length never wrap inside, so `--language` or `jcode-works/...` stay whole. */
const NOWRAP_TOKEN_MAX_LENGTH = 40

function tokenClass(token: string, expectProgram: boolean): string {
  const wrap = token.length <= NOWRAP_TOKEN_MAX_LENGTH ? " whitespace-nowrap" : ""
  if (expectProgram && (PROGRAMS.has(token) || token.startsWith("/"))) {
    return `text-[var(--syntax-program)]${wrap}`
  }
  if (token.startsWith('"') || token.startsWith("'")) return `text-[var(--syntax-string)]${wrap}`
  if (token.startsWith("-")) return `text-foreground/55${wrap}`
  if (token === "&&" || token === "|" || token === ";") return "text-foreground/55"
  return `text-foreground/90${wrap}`
}

const CALL_PATTERN = /^([\w.]+)(\()([\s\S]*)$/u
const STRING_PATTERN = /("[^"]*"?)/gu

/** Colours a tool call such as `ragmir_search({ query: "..." })`: name, then its string arguments. */
export function highlightCall(call: string): ReactNode[] {
  const match = call.match(CALL_PATTERN)
  if (!match) return [call]
  const [, name = "", open = "", rest = ""] = match
  const nodes: ReactNode[] = [
    <span className="text-[var(--syntax-program)]" key="name">
      {name}
    </span>,
    <span className="text-foreground/60" key="open">
      {open}
    </span>,
  ]
  let position = 0
  for (const part of rest.split(STRING_PATTERN)) {
    if (!part) continue
    nodes.push(
      <span
        className={part.startsWith('"') ? "text-[var(--syntax-string)]" : "text-foreground/60"}
        key={`part-${position}`}
      >
        {part}
      </span>,
    )
    position += 1
  }
  return nodes
}

const CODE_KEYWORDS = new Set(["await", "const", "let", "return", "new"])
const CODE_TOKEN_PATTERN = /("[^"]*"?|\b(?:await|const|let|return|new)\b)/gu

/** Colours a line of TypeScript: keywords in the accent colour and string literals in the second hue. */
export function highlightCode(code: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let position = 0
  for (const part of code.split(CODE_TOKEN_PATTERN)) {
    if (!part) continue
    const className = part.startsWith('"')
      ? "text-[var(--syntax-string)]"
      : CODE_KEYWORDS.has(part)
        ? "text-[var(--syntax-program)]"
        : "text-foreground/85"
    nodes.push(
      <span className={className} key={position}>
        {part}
      </span>,
    )
    position += 1
  }
  return nodes
}

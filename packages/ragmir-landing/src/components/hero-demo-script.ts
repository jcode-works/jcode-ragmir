export type TerminalLineKind =
  | "shell"
  | "codex"
  | "script"
  | "tree"
  | "output"
  | "mcp"
  | "citation"
  | "insight"
  | "change"
  | "success"

type TerminalLineBase = {
  kind: TerminalLineKind
  holdMs?: number
}

type LiteralTerminalLine = TerminalLineBase & {
  text: string
  textKey?: never
}

type LocalizedTerminalLine = TerminalLineBase & {
  text?: never
  textKey: string
}

export type TerminalScriptLine = LiteralTerminalLine | LocalizedTerminalLine

export interface HeroDemoScenario {
  id: string
  titleKey: string
  descriptionKey: string
  terminalTitle: string
  badgeKey: string
  lines: readonly TerminalScriptLine[]
}

export const HERO_DEMO_SCENARIOS: readonly HeroDemoScenario[] = [
  {
    id: "word",
    titleKey: "demo_scenario_word_title",
    descriptionKey: "demo_scenario_word_description",
    terminalTitle: "Claude Code / Codex | ~/projects/account-recovery",
    badgeKey: "demo_badge_word",
    lines: [
      { kind: "output", textKey: "demo_step_index" },
      { kind: "shell", text: 'npx rgr sources add "specs/**/*.docx" "docs/**/*.md"' },
      { kind: "shell", text: "npx rgr ingest" },
      { kind: "output", textKey: "demo_step_search" },
      { kind: "codex", textKey: "demo_word_prompt" },
      { kind: "mcp", textKey: "demo_word_search_command" },
      { kind: "citation", text: "[1] specs/account-recovery.docx#2" },
      { kind: "mcp", text: 'ragmir_expand({ citation: "specs/account-recovery.docx#2" })' },
      { kind: "insight", textKey: "demo_word_out_rules", holdMs: 1700 },
      { kind: "output", textKey: "demo_step_refine" },
      { kind: "mcp", textKey: "demo_word_exception_search" },
      { kind: "citation", text: "[2] docs/adr/0012-authentication.md:L18-L26#2" },
      { kind: "codex", textKey: "demo_word_implement" },
      { kind: "success", textKey: "demo_word_out_done", holdMs: 1700 },
    ],
  },
  {
    id: "local",
    titleKey: "demo_scenario_local_title",
    descriptionKey: "demo_scenario_local_description",
    terminalTitle: "Chat | ~/projects/architecture",
    badgeKey: "demo_badge_local",
    lines: [
      { kind: "output", textKey: "demo_chat_step_index" },
      { kind: "shell", text: 'npx rgr sources add "private/**/*.md"' },
      { kind: "shell", text: "npx rgr ingest" },
      { kind: "output", textKey: "demo_chat_step_question" },
      { kind: "script", textKey: "demo_chat_question" },
      { kind: "mcp", textKey: "demo_chat_search_command" },
      { kind: "citation", text: "[1] private/architecture.md:L18-L26#2" },
      { kind: "mcp", text: 'ragmir_expand({ citation: "private/architecture.md:L18-L26#2" })' },
      { kind: "insight", textKey: "demo_chat_excerpt", holdMs: 1400 },
      { kind: "output", textKey: "demo_chat_step_model" },
      { kind: "output", textKey: "demo_chat_model_options" },
      { kind: "script", textKey: "demo_local_out_context" },
      { kind: "insight", textKey: "demo_local_out_answer", holdMs: 1700 },
      { kind: "success", textKey: "demo_local_out_done", holdMs: 1700 },
    ],
  },
]

export const DEFAULT_HERO_DEMO_SCENARIO = HERO_DEMO_SCENARIOS[0]

export function findHeroDemoScenario(id: string): HeroDemoScenario {
  return HERO_DEMO_SCENARIOS.find((scenario) => scenario.id === id) ?? DEFAULT_HERO_DEMO_SCENARIO
}

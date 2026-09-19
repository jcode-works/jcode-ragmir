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
    terminalTitle: "Ollama local | ~/projects/account-recovery",
    badgeKey: "demo_badge_word",
    lines: [
      { kind: "output", textKey: "demo_step_index" },
      { kind: "shell", text: 'npx rgr sources add "private/**/*.docx"' },
      { kind: "shell", text: "npx rgr ingest" },
      { kind: "output", textKey: "demo_step_search" },
      { kind: "script", textKey: "demo_word_prompt" },
      { kind: "mcp", textKey: "demo_word_search_command" },
      { kind: "citation", text: "[1] private/specification.docx#2" },
      { kind: "output", textKey: "demo_step_expand" },
      { kind: "mcp", text: 'ragmir_expand({ citation: "private/specification.docx#2" })' },
      { kind: "insight", textKey: "demo_word_out_rules", holdMs: 1700 },
      { kind: "output", textKey: "demo_step_implement" },
      { kind: "script", textKey: "demo_word_implement" },
      { kind: "change", textKey: "demo_word_out_changes" },
      { kind: "success", textKey: "demo_word_out_done", holdMs: 1700 },
    ],
  },
  {
    id: "local",
    titleKey: "demo_scenario_local_title",
    descriptionKey: "demo_scenario_local_description",
    terminalTitle: "Ollama local | ~/projects/account-recovery",
    badgeKey: "demo_badge_local",
    lines: [
      { kind: "output", textKey: "demo_chat_step_question" },
      { kind: "script", textKey: "demo_chat_question" },
      { kind: "output", textKey: "demo_chat_step_retrieve" },
      { kind: "mcp", textKey: "demo_word_search_command" },
      { kind: "citation", text: "[1] private/specification.docx#2" },
      { kind: "mcp", text: 'ragmir_expand({ citation: "private/specification.docx#2" })' },
      { kind: "insight", textKey: "demo_chat_excerpt", holdMs: 1400 },
      { kind: "output", textKey: "demo_chat_step_model" },
      { kind: "output", textKey: "demo_chat_local_endpoint" },
      { kind: "script", textKey: "demo_local_out_context" },
      { kind: "insight", textKey: "demo_local_out_answer", holdMs: 1700 },
      { kind: "success", textKey: "demo_local_out_done", holdMs: 1700 },
    ],
  },
  {
    id: "monorepo",
    titleKey: "demo_scenario_monorepo_title",
    descriptionKey: "demo_scenario_monorepo_description",
    terminalTitle: "zsh | ~/code/platform",
    badgeKey: "demo_badge_monorepo",
    lines: [
      { kind: "shell", text: "cd ~/code/platform" },
      { kind: "shell", text: "npx rgr bases --json" },
      { kind: "output", textKey: "demo_monorepo_out_sources" },
      { kind: "codex", textKey: "demo_monorepo_prompt" },
      {
        kind: "mcp",
        textKey: "demo_monorepo_root_search_command",
      },
      { kind: "citation", text: "[1] docs/adr/0042-auth-contract.md:L18-L31#3" },
      {
        kind: "mcp",
        textKey: "demo_monorepo_api_search_command",
      },
      { kind: "citation", text: "[2] packages/api-client/docs/auth.md:L11-L24#2" },
      {
        kind: "mcp",
        textKey: "demo_monorepo_session_search_command",
      },
      { kind: "citation", text: "[3] packages/session/docs/lifecycle.md:L36-L49#5" },
      { kind: "insight", textKey: "demo_monorepo_out_plan", holdMs: 1700 },
      { kind: "change", text: "+ docs/onboarding/authentication-map.md" },
      { kind: "success", textKey: "demo_monorepo_out_done", holdMs: 1700 },
    ],
  },
  {
    id: "ocr",
    titleKey: "demo_scenario_ocr_title",
    descriptionKey: "demo_scenario_ocr_description",
    terminalTitle: "zsh | ~/projects/operations",
    badgeKey: "demo_badge_ocr",
    lines: [
      { kind: "shell", text: 'npx rgr sources add "runbooks/**/*.pdf"' },
      { kind: "shell", text: "npx rgr ocr doctor" },
      { kind: "shell", text: "npx rgr ocr setup --language eng+fra" },
      { kind: "shell", text: "npx rgr ingest" },
      { kind: "success", textKey: "demo_ocr_out_indexed", holdMs: 1400 },
      { kind: "mcp", textKey: "demo_ocr_search_command" },
      { kind: "citation", text: "[1] runbooks/recovery.pdf:p8#9" },
      { kind: "insight", textKey: "demo_ocr_out_evidence", holdMs: 1700 },
      { kind: "success", textKey: "demo_ocr_out_done", holdMs: 1700 },
    ],
  },
]

export const DEFAULT_HERO_DEMO_SCENARIO = HERO_DEMO_SCENARIOS[0]

export function findHeroDemoScenario(id: string): HeroDemoScenario {
  return HERO_DEMO_SCENARIOS.find((scenario) => scenario.id === id) ?? DEFAULT_HERO_DEMO_SCENARIO
}

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
  /** Label above the line when the default one for its kind does not fit, such as a runtime name. */
  prefix?: string
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
    id: "feature",
    titleKey: "demo_scenario_feature_title",
    descriptionKey: "demo_scenario_feature_description",
    terminalTitle: "Claude Code / Codex | ~/projects/account-recovery",
    badgeKey: "demo_badge_feature",
    lines: [
      { kind: "output", textKey: "demo_feature_step_index" },
      { kind: "shell", text: 'npx rgr sources add "specs/**/*.docx" "docs/**/*.md"' },
      { kind: "shell", text: "npx rgr ingest" },
      { kind: "output", textKey: "demo_feature_step_search" },
      { kind: "codex", textKey: "demo_feature_prompt" },
      { kind: "mcp", textKey: "demo_feature_search_command" },
      { kind: "citation", text: "[1] specs/account-recovery.docx#2" },
      { kind: "mcp", text: 'ragmir_expand({ citation: "specs/account-recovery.docx#2" })' },
      { kind: "insight", textKey: "demo_feature_out_rules", holdMs: 1700 },
      { kind: "output", textKey: "demo_feature_step_refine" },
      { kind: "mcp", textKey: "demo_feature_exception_search" },
      { kind: "citation", text: "[2] docs/adr/0012-authentication.md:L18-L26#2" },
      { kind: "codex", textKey: "demo_feature_implement" },
      { kind: "success", textKey: "demo_feature_out_done", holdMs: 1700 },
    ],
  },
  {
    id: "incident",
    titleKey: "demo_scenario_incident_title",
    descriptionKey: "demo_scenario_incident_description",
    terminalTitle: "Claude Code / Codex | ~/projects/checkout",
    badgeKey: "demo_badge_incident",
    lines: [
      { kind: "output", textKey: "demo_incident_step_index" },
      {
        kind: "shell",
        text: 'npx rgr sources add "docs/runbooks/**/*.md" "docs/incidents/**/*.md" "src/**/*.ts"',
      },
      { kind: "shell", text: "npx rgr ingest" },
      { kind: "output", textKey: "demo_incident_step_search" },
      { kind: "codex", textKey: "demo_incident_prompt" },
      { kind: "mcp", textKey: "demo_incident_search_command" },
      { kind: "citation", text: "[1] docs/runbooks/checkout-timeouts.md:L12-L21#1" },
      {
        kind: "mcp",
        text: 'ragmir_expand({ citation: "docs/runbooks/checkout-timeouts.md:L12-L21#1" })',
      },
      { kind: "insight", textKey: "demo_incident_out_rule", holdMs: 1700 },
      { kind: "output", textKey: "demo_incident_step_refine" },
      { kind: "mcp", textKey: "demo_incident_retry_search" },
      { kind: "citation", text: "[2] src/checkout/retry.ts:L38-L57#3" },
      { kind: "codex", textKey: "demo_incident_implement" },
      { kind: "success", textKey: "demo_incident_out_done", holdMs: 1700 },
    ],
  },
  {
    id: "product",
    titleKey: "demo_scenario_product_title",
    descriptionKey: "demo_scenario_product_description",
    terminalTitle: "Node.js app | ~/apps/contract-assistant",
    badgeKey: "demo_badge_product",
    lines: [
      { kind: "output", textKey: "demo_product_step_index" },
      { kind: "shell", text: 'npx rgr sources add "contracts/**/*.pdf" "policies/**/*.docx"' },
      { kind: "shell", text: "npx rgr ingest" },
      { kind: "output", textKey: "demo_product_step_answer" },
      {
        kind: "script",
        prefix: "LangChain.js",
        text: 'await retriever.invoke("termination notice period")',
      },
      { kind: "citation", text: "[1] contracts/msa-acme-2026.pdf:p7#3" },
      { kind: "insight", textKey: "demo_product_out_rule", holdMs: 1500 },
      { kind: "output", textKey: "demo_product_step_refusal" },
      {
        kind: "script",
        prefix: "LangChain.js",
        text: 'await retriever.invoke("CEO mobile phone number")',
      },
      { kind: "insight", textKey: "demo_product_out_refusal", holdMs: 1500 },
      { kind: "success", textKey: "demo_product_out_done", holdMs: 1700 },
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

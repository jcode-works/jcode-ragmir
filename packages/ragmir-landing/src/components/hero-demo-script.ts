export type TerminalLineKind =
  | "shell"
  | "codex"
  | "hermes"
  | "n8n"
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
  badge: string
  lines: readonly TerminalScriptLine[]
}

export const HERO_DEMO_SCENARIOS: readonly HeroDemoScenario[] = [
  {
    id: "word",
    titleKey: "demo_scenario_word_title",
    descriptionKey: "demo_scenario_word_description",
    terminalTitle: "zsh | ~/projects/account-recovery",
    badge: "DOCX local",
    lines: [
      { kind: "shell", text: "cd ~/projects/account-recovery" },
      { kind: "shell", text: "npx rgr setup --agents codex" },
      { kind: "output", textKey: "demo_word_out_setup" },
      { kind: "tree", text: "private/requirements.docx  private/acceptance-criteria.docx" },
      { kind: "shell", text: 'npx rgr sources add "private/**/*.docx"' },
      { kind: "shell", text: "npx rgr doctor --fix" },
      { kind: "success", textKey: "demo_word_out_indexed", holdMs: 1400 },
      {
        kind: "codex",
        text: "Implement account recovery from the confidential requirements. Cite every rule.",
      },
      { kind: "mcp", text: 'ragmir_search("account recovery lockout acceptance criteria")' },
      { kind: "citation", text: "[1] private/requirements.docx:12" },
      { kind: "citation", text: "[2] private/acceptance-criteria.docx:7" },
      { kind: "insight", textKey: "demo_word_out_rules", holdMs: 1700 },
      { kind: "change", text: "+ src/auth/account-recovery.ts" },
      { kind: "change", text: "+ tests/e2e/account-recovery.spec.ts" },
      { kind: "success", textKey: "demo_word_out_done", holdMs: 1700 },
    ],
  },
  {
    id: "drive",
    titleKey: "demo_scenario_drive_title",
    descriptionKey: "demo_scenario_drive_description",
    terminalTitle: "zsh | ~/projects/atlas",
    badge: "Synced Drive",
    lines: [
      { kind: "shell", text: "cd ~/projects/atlas" },
      {
        kind: "tree",
        text: "planning.xlsx  user-stories.xlsx  product-spec.docx  database-mcd.pdf",
      },
      {
        kind: "shell",
        text: 'npx rgr sources add "$HOME/Library/CloudStorage/GoogleDrive-acme/Shared drives/Atlas/**/*"',
      },
      { kind: "output", textKey: "demo_drive_out_sync", holdMs: 1400 },
      { kind: "shell", text: "npx rgr ingest" },
      { kind: "success", textKey: "demo_drive_out_indexed", holdMs: 1400 },
      {
        kind: "codex",
        text: "Plan release one from the planning, user stories, product spec, and database MCD.",
      },
      { kind: "mcp", text: 'ragmir_search("release one scope dependencies data model")' },
      { kind: "citation", text: "[1] planning.xlsx:Roadmap > R1" },
      { kind: "citation", text: "[2] user-stories.xlsx:Backlog > US-24" },
      { kind: "citation", text: "[3] database-mcd.pdf:4" },
      { kind: "insight", textKey: "demo_drive_out_plan", holdMs: 1700 },
      { kind: "success", textKey: "demo_drive_out_done", holdMs: 1700 },
    ],
  },
  {
    id: "n8n",
    titleKey: "demo_scenario_n8n_title",
    descriptionKey: "demo_scenario_n8n_description",
    terminalTitle: "n8n | sales-evidence-gate",
    badge: "Self-hosted",
    lines: [
      { kind: "shell", text: "cd ~/automation/sales-evidence" },
      {
        kind: "tree",
        text: "sales/account-plan.docx  sales/discovery-notes.pdf  sales/pricing.xlsx",
      },
      { kind: "shell", text: 'npx rgr sources add "sales/**/*"' },
      { kind: "shell", text: "npx rgr ingest" },
      { kind: "success", textKey: "demo_n8n_out_indexed", holdMs: 1400 },
      { kind: "n8n", text: "Execute Command → node scripts/ragmir-sales-evidence.mjs" },
      { kind: "output", textKey: "demo_n8n_out_input" },
      { kind: "mcp", text: 'search("renewal risk budget owner pricing exception", { topK: 5 })' },
      { kind: "citation", text: "[1] sales/discovery-notes.pdf:6" },
      { kind: "citation", text: "[2] sales/pricing.xlsx:Exceptions > ACME" },
      { kind: "insight", textKey: "demo_n8n_out_decision", holdMs: 1700 },
      { kind: "success", textKey: "demo_n8n_out_done", holdMs: 1700 },
    ],
  },
  {
    id: "hermes",
    titleKey: "demo_scenario_hermes_title",
    descriptionKey: "demo_scenario_hermes_description",
    terminalTitle: "zsh | ~/operations/support",
    badge: "Hermes MCP",
    lines: [
      { kind: "shell", text: "cd ~/operations/support" },
      { kind: "shell", text: 'npx rgr sources add "support/**/*.docx" "runbooks/**/*.pdf"' },
      { kind: "shell", text: "npx rgr setup" },
      { kind: "output", textKey: "demo_hermes_out_setup" },
      {
        kind: "shell",
        text: "hermes mcp add ragmir --command node --args .ragmir/run.cjs",
      },
      { kind: "success", textKey: "demo_hermes_out_connected", holdMs: 1400 },
      {
        kind: "hermes",
        text: "Map the escalation path for a P1 support case. Cite the source for every step.",
      },
      { kind: "mcp", text: 'ragmir_search("P1 escalation owner response time")' },
      { kind: "citation", text: "[1] support/escalation-matrix.docx:9" },
      { kind: "citation", text: "[2] runbooks/p1-response.pdf:3" },
      { kind: "insight", textKey: "demo_hermes_out_path", holdMs: 1700 },
      { kind: "success", textKey: "demo_hermes_out_done", holdMs: 1700 },
    ],
  },
  {
    id: "monorepo",
    titleKey: "demo_scenario_monorepo_title",
    descriptionKey: "demo_scenario_monorepo_description",
    terminalTitle: "zsh | ~/code/platform",
    badge: "31 packages",
    lines: [
      { kind: "shell", text: "cd ~/code/platform" },
      { kind: "shell", text: "npx rgr setup --agents codex" },
      {
        kind: "shell",
        text: 'npx rgr sources add "packages/*/README.md" "packages/*/docs/**/*" "docs/adr/**/*"',
      },
      { kind: "output", textKey: "demo_monorepo_out_sources" },
      { kind: "shell", text: "npx rgr ingest" },
      { kind: "success", textKey: "demo_monorepo_out_indexed", holdMs: 1400 },
      {
        kind: "codex",
        text: "Plan the auth contract migration across every library without breaking consumers.",
      },
      { kind: "mcp", text: 'ragmir_search("auth contract migration consumers deprecation")' },
      { kind: "citation", text: "[1] docs/adr/0042-auth-contract.md:18" },
      { kind: "citation", text: "[2] packages/api-client/docs/migration.md:11" },
      { kind: "citation", text: "[3] packages/session/README.md:36" },
      { kind: "insight", textKey: "demo_monorepo_out_plan", holdMs: 1700 },
      { kind: "change", text: "+ docs/plans/auth-contract-migration.md" },
      { kind: "success", textKey: "demo_monorepo_out_done", holdMs: 1700 },
    ],
  },
  {
    id: "gameplan",
    titleKey: "demo_scenario_gameplan_title",
    descriptionKey: "demo_scenario_gameplan_description",
    terminalTitle: "zsh | ~/vault/project-phoenix",
    badge: "Private plan",
    lines: [
      { kind: "shell", text: "cd ~/vault/project-phoenix" },
      { kind: "tree", text: "game-plan/strategy.docx  game-plan/budget.xlsx  game-plan/risks.pdf" },
      { kind: "shell", text: 'npx rgr sources add "game-plan/**/*"' },
      { kind: "shell", text: "npx rgr doctor --fix" },
      { kind: "success", textKey: "demo_gameplan_out_indexed", holdMs: 1400 },
      {
        kind: "codex",
        text: "Turn the confidential game plan into a 30-day execution plan. Flag every assumption.",
      },
      { kind: "mcp", text: 'ragmir_search("first 30 days budget dependencies top risks")' },
      { kind: "citation", text: "[1] game-plan/strategy.docx:14" },
      { kind: "citation", text: "[2] game-plan/budget.xlsx:Runway > Q3" },
      { kind: "citation", text: "[3] game-plan/risks.pdf:5" },
      { kind: "insight", textKey: "demo_gameplan_out_plan", holdMs: 1700 },
      { kind: "change", text: "+ .ragmir/reports/30-day-game-plan.md" },
      { kind: "success", textKey: "demo_gameplan_out_done", holdMs: 1700 },
    ],
  },
]

export const DEFAULT_HERO_DEMO_SCENARIO = HERO_DEMO_SCENARIOS[0]

export function findHeroDemoScenario(id: string): HeroDemoScenario {
  return HERO_DEMO_SCENARIOS.find((scenario) => scenario.id === id) ?? DEFAULT_HERO_DEMO_SCENARIO
}

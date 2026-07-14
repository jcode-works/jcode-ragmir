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
  badgeKey: string
  lines: readonly TerminalScriptLine[]
}

export const HERO_DEMO_SCENARIOS: readonly HeroDemoScenario[] = [
  {
    id: "word",
    titleKey: "demo_scenario_word_title",
    descriptionKey: "demo_scenario_word_description",
    terminalTitle: "zsh | ~/projects/account-recovery",
    badgeKey: "demo_badge_word",
    lines: [
      { kind: "shell", text: "cd ~/projects/account-recovery" },
      { kind: "shell", text: "npm install --save-dev @jcode.labs/ragmir" },
      { kind: "shell", text: "npx rgr setup --agents codex" },
      { kind: "output", textKey: "demo_word_out_setup" },
      { kind: "tree", text: "private/requirements.docx  private/acceptance-criteria.docx" },
      { kind: "shell", text: 'npx rgr sources add "private/**/*.docx"' },
      { kind: "shell", text: "npx rgr doctor --fix" },
      { kind: "success", textKey: "demo_word_out_indexed", holdMs: 1400 },
      {
        kind: "codex",
        textKey: "demo_word_prompt",
      },
      {
        kind: "mcp",
        text: 'ragmir_search({ query: "account recovery lockout acceptance criteria", topK: 5 })',
      },
      { kind: "citation", text: "[1] private/requirements.docx:L12-L18#2" },
      { kind: "citation", text: "[2] private/acceptance-criteria.docx:L7-L13#1" },
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
    badgeKey: "demo_badge_drive",
    lines: [
      { kind: "shell", text: "cd ~/projects/atlas" },
      { kind: "shell", text: "npm install --save-dev @jcode.labs/ragmir" },
      { kind: "shell", text: "npx rgr setup --agents codex --no-ingest" },
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
        textKey: "demo_drive_prompt",
      },
      {
        kind: "mcp",
        text: 'ragmir_search({ query: "release one scope dependencies data model", topK: 5 })',
      },
      { kind: "citation", text: "[1] planning.xlsx:L42-L48#8" },
      { kind: "citation", text: "[2] user-stories.xlsx:L75-L83#12" },
      { kind: "citation", text: "[3] database-mcd.pdf:p4:L88-L102#5" },
      { kind: "insight", textKey: "demo_drive_out_plan", holdMs: 1700 },
      { kind: "success", textKey: "demo_drive_out_done", holdMs: 1700 },
    ],
  },
  {
    id: "n8n",
    titleKey: "demo_scenario_n8n_title",
    descriptionKey: "demo_scenario_n8n_description",
    terminalTitle: "n8n | renewal-evidence-gate",
    badgeKey: "demo_badge_n8n",
    lines: [
      { kind: "shell", text: "cd ~/automation/sales-evidence" },
      { kind: "shell", text: "npm install --save-dev @jcode.labs/ragmir" },
      { kind: "shell", text: "npx rgr setup --no-ingest" },
      {
        kind: "tree",
        text: "sales/account-plan.docx  sales/discovery-notes.pdf  sales/pricing.xlsx",
      },
      { kind: "shell", text: 'npx rgr sources add "sales/**/*"' },
      { kind: "shell", text: "npx rgr ingest" },
      { kind: "success", textKey: "demo_n8n_out_indexed", holdMs: 1400 },
      { kind: "output", textKey: "demo_n8n_out_input" },
      { kind: "n8n", text: "Webhook → Execute Command → IF → Human approval" },
      { kind: "n8n", text: "Execute Command → /opt/ragmir/bin/renewal-gate.sh" },
      {
        kind: "shell",
        text: 'npx rgr search "renewal risk budget owner pricing exception" --top-k 5 --compact --json',
      },
      { kind: "citation", text: "[1] sales/discovery-notes.pdf:p6:L120-L134#7" },
      { kind: "citation", text: "[2] sales/pricing.xlsx:L18-L22#3" },
      { kind: "insight", textKey: "demo_n8n_out_decision", holdMs: 1700 },
      { kind: "success", textKey: "demo_n8n_out_done", holdMs: 1700 },
    ],
  },
  {
    id: "hermes",
    titleKey: "demo_scenario_hermes_title",
    descriptionKey: "demo_scenario_hermes_description",
    terminalTitle: "zsh | ~/operations/support",
    badgeKey: "demo_badge_hermes",
    lines: [
      { kind: "shell", text: "cd ~/operations/support" },
      { kind: "shell", text: "npm install --save-dev @jcode.labs/ragmir" },
      { kind: "shell", text: "npx rgr setup" },
      { kind: "shell", text: 'npx rgr sources add "support/**/*.docx" "runbooks/**/*.pdf"' },
      { kind: "shell", text: "npx rgr ingest" },
      { kind: "output", textKey: "demo_hermes_out_setup" },
      {
        kind: "shell",
        text: 'hermes mcp add ragmir --command node --args "$PWD/.ragmir/run.cjs"',
      },
      { kind: "success", textKey: "demo_hermes_out_connected", holdMs: 1400 },
      {
        kind: "hermes",
        textKey: "demo_hermes_prompt",
      },
      {
        kind: "mcp",
        text: 'ragmir_search({ query: "P1 escalation owner response time", topK: 5 })',
      },
      { kind: "citation", text: "[1] support/escalation-matrix.docx:L9-L17#2" },
      { kind: "citation", text: "[2] runbooks/p1-response.pdf:p3:L64-L82#4" },
      { kind: "insight", textKey: "demo_hermes_out_path", holdMs: 1700 },
      { kind: "success", textKey: "demo_hermes_out_done", holdMs: 1700 },
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
      { kind: "shell", text: "npm install --save-dev @jcode.labs/ragmir" },
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
        textKey: "demo_monorepo_prompt",
      },
      {
        kind: "mcp",
        text: 'ragmir_search({ query: "auth contract migration consumers deprecation", topK: 5 })',
      },
      { kind: "citation", text: "[1] docs/adr/0042-auth-contract.md:L18-L31#3" },
      { kind: "citation", text: "[2] packages/api-client/docs/migration.md:L11-L24#2" },
      { kind: "citation", text: "[3] packages/session/README.md:L36-L49#5" },
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
    badgeKey: "demo_badge_gameplan",
    lines: [
      { kind: "shell", text: "cd ~/vault/project-phoenix" },
      { kind: "shell", text: "npm install --save-dev @jcode.labs/ragmir" },
      { kind: "shell", text: "npx rgr setup --no-ingest" },
      { kind: "tree", text: "game-plan/strategy.docx  game-plan/budget.xlsx  game-plan/risks.pdf" },
      { kind: "shell", text: 'npx rgr sources add "game-plan/**/*"' },
      { kind: "shell", text: "npx rgr doctor --fix" },
      { kind: "success", textKey: "demo_gameplan_out_indexed", holdMs: 1400 },
      {
        kind: "codex",
        textKey: "demo_gameplan_prompt",
      },
      {
        kind: "mcp",
        text: 'ragmir_search({ query: "first 30 days budget dependencies top risks", topK: 5 })',
      },
      { kind: "citation", text: "[1] game-plan/strategy.docx:L14-L23#2" },
      { kind: "citation", text: "[2] game-plan/budget.xlsx:L32-L39#6" },
      { kind: "citation", text: "[3] game-plan/risks.pdf:p5:L108-L124#7" },
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

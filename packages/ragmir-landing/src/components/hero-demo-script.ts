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
    terminalTitle: "zsh | ~/projects/account-recovery",
    badgeKey: "demo_badge_word",
    lines: [
      { kind: "shell", text: "cd ~/projects/account-recovery" },
      { kind: "shell", text: "npm install --save-dev @jcode.labs/ragmir" },
      { kind: "shell", text: "npx rgr setup --agents codex --no-ingest" },
      { kind: "output", textKey: "demo_word_out_setup" },
      { kind: "shell", text: 'npx rgr sources add "private/**/*.docx"' },
      { kind: "shell", text: "npx rgr ingest" },
      { kind: "success", textKey: "demo_word_out_indexed", holdMs: 1400 },
      { kind: "codex", textKey: "demo_word_prompt" },
      {
        kind: "mcp",
        textKey: "demo_word_search_command",
      },
      { kind: "citation", text: "[1] private/specification.docx#2" },
      { kind: "citation", text: "[2] private/acceptance-criteria.docx#1" },
      { kind: "insight", textKey: "demo_word_out_rules", holdMs: 1700 },
      { kind: "change", text: "+ account recovery implementation + E2E tests" },
      { kind: "success", textKey: "demo_word_out_done", holdMs: 1700 },
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
    id: "drive",
    titleKey: "demo_scenario_drive_title",
    descriptionKey: "demo_scenario_drive_description",
    terminalTitle: "zsh | ~/projects/atlas",
    badgeKey: "demo_badge_drive",
    lines: [
      { kind: "shell", text: "cd ~/projects/atlas" },
      { kind: "shell", text: "npx rgr setup --agents codex --no-ingest" },
      {
        kind: "shell",
        text: 'npx rgr sources add "$HOME/Library/CloudStorage/GoogleDrive-*/My Drive/Product/**/*"',
      },
      { kind: "shell", text: "npx rgr ingest" },
      { kind: "output", textKey: "demo_drive_out_sync", holdMs: 900 },
      { kind: "success", textKey: "demo_drive_out_indexed", holdMs: 1400 },
      { kind: "codex", textKey: "demo_drive_prompt" },
      {
        kind: "mcp",
        textKey: "demo_drive_search_command",
      },
      { kind: "citation", text: "[1] roadmap.pdf:p4#5" },
      { kind: "citation", text: "[2] stories.xlsx:sheet=Stories:cells=A42-D42#8" },
      { kind: "citation", text: "[3] architecture.docx#12" },
      { kind: "insight", textKey: "demo_drive_out_plan", holdMs: 1700 },
      { kind: "change", text: "+ team invitations implementation + tests" },
      { kind: "success", textKey: "demo_drive_out_done", holdMs: 1700 },
    ],
  },
  {
    id: "youtube",
    titleKey: "demo_scenario_youtube_title",
    descriptionKey: "demo_scenario_youtube_description",
    terminalTitle: "zsh | ~/content/youtube-research",
    badgeKey: "demo_badge_youtube",
    lines: [
      { kind: "shell", text: "cd ~/content/youtube-research" },
      { kind: "shell", text: "npx rgr setup --agents codex --no-ingest" },
      { kind: "shell", text: 'npx rgr sources add "library/**/*" "channel/voice.md"' },
      { kind: "shell", text: "npx rgr ingest" },
      { kind: "success", textKey: "demo_youtube_out_indexed", holdMs: 1400 },
      {
        kind: "shell",
        textKey: "demo_youtube_draft_command",
      },
      { kind: "script", textKey: "demo_youtube_script_research" },
      { kind: "citation", text: "[1] library/research.pdf:p8#9" },
      { kind: "citation", text: "[2] channel/voice.md:L24-L39#4" },
      { kind: "codex", textKey: "demo_youtube_prompt" },
      { kind: "change", text: "+ drafts/why-habits-outlast-motivation.md" },
      { kind: "success", textKey: "demo_youtube_out_done", holdMs: 1700 },
    ],
  },
  {
    id: "visa",
    titleKey: "demo_scenario_visa_title",
    descriptionKey: "demo_scenario_visa_description",
    terminalTitle: "zsh | ~/private/visa-project",
    badgeKey: "demo_badge_visa",
    lines: [
      { kind: "shell", text: "cd ~/private/visa-project" },
      { kind: "shell", text: "npx rgr setup --no-ingest" },
      { kind: "shell", text: 'npx rgr sources add "**/*.pdf" "**/*.xlsx" "**/*.docx"' },
      { kind: "shell", text: "npx rgr ingest" },
      { kind: "success", textKey: "demo_visa_out_indexed", holdMs: 1400 },
      { kind: "shell", text: "node scripts/update-project-plan.mjs" },
      { kind: "script", textKey: "demo_visa_script_research" },
      { kind: "citation", text: "[1] official-guidance.pdf:p6#7" },
      { kind: "citation", text: "[2] appointments.xlsx:sheet=Appointments:cells=A18-D18#3" },
      { kind: "citation", text: "[3] checklist.docx#5" },
      { kind: "change", text: "+ .ragmir/reports/action-plan.md" },
      { kind: "success", textKey: "demo_visa_out_done", holdMs: 1700 },
    ],
  },
]

export const DEFAULT_HERO_DEMO_SCENARIO = HERO_DEMO_SCENARIOS[0]

export function findHeroDemoScenario(id: string): HeroDemoScenario {
  return HERO_DEMO_SCENARIOS.find((scenario) => scenario.id === id) ?? DEFAULT_HERO_DEMO_SCENARIO
}

export type TerminalLineKind =
  | "shell"
  | "codex"
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
    id: "military",
    titleKey: "demo_scenario_military_title",
    descriptionKey: "demo_scenario_military_description",
    terminalTitle: "zsh | ~/projects/force-readiness-kit",
    badge: "Secure AI",
    lines: [
      { kind: "shell", text: "cd ~/projects/force-readiness-kit" },
      { kind: "shell", text: "codex" },
      { kind: "output", textKey: "demo_military_out_codex_ready" },
      { kind: "codex", text: "ls" },
      { kind: "tree", text: "README.md  src/  docs/doctrine/  docs/cyber/  reports/" },
      { kind: "codex", text: "npx rgr setup --agents codex,claude" },
      { kind: "output", textKey: "demo_military_out_setup" },
      {
        kind: "codex",
        text: "mkdir -p .ragmir/raw && cp ~/Desktop/exercise-after-action.md .ragmir/raw/",
      },
      { kind: "output", textKey: "demo_military_out_raw_copy", holdMs: 1400 },
      {
        kind: "codex",
        text: 'npx rgr sources add "docs/doctrine/**/*.md" "docs/cyber/**/*.md" "reports/readiness/**/*.md"',
      },
      { kind: "output", textKey: "demo_military_out_sources" },
      { kind: "codex", text: "npx rgr doctor --fix" },
      { kind: "success", textKey: "demo_military_out_indexed", holdMs: 1500 },
      {
        kind: "codex",
        text: "Use Ragmir to brief readiness gaps with citations only, no raw corpus in the prompt.",
      },
      { kind: "mcp", text: 'ragmir_search("readiness gaps cyber hardening exercise actions")' },
      { kind: "citation", text: "[1] .ragmir/raw/exercise-after-action.md:9" },
      { kind: "mcp", text: 'ragmir_search("secure deployment communications approval doctrine")' },
      { kind: "citation", text: "[2] docs/cyber/hardening-baseline.md:17" },
      { kind: "insight", textKey: "demo_military_out_brief", holdMs: 1800 },
      { kind: "change", text: "+ .ragmir/reports/secure-readiness-brief.md" },
      { kind: "success", textKey: "demo_military_out_done", holdMs: 1800 },
    ],
  },
  {
    id: "dev",
    titleKey: "demo_scenario_dev_title",
    descriptionKey: "demo_scenario_dev_description",
    terminalTitle: "zsh | ~/projects/secure-workspace",
    badge: "Confidential",
    lines: [
      { kind: "shell", text: "cd ~/projects/secure-workspace" },
      { kind: "shell", text: "codex" },
      { kind: "output", textKey: "demo_dev_out_codex_ready" },
      { kind: "codex", text: "ls" },
      { kind: "tree", text: "src/  tests/  docs/  specs/  package.json" },
      { kind: "codex", text: "npx rgr setup --agents codex" },
      { kind: "output", textKey: "demo_out_setup_codex" },
      {
        kind: "codex",
        text: "mkdir -p .ragmir/raw && cp ~/Desktop/confidential-cdc-v4.pdf .ragmir/raw/",
      },
      { kind: "output", textKey: "demo_dev_out_raw_copy", holdMs: 1400 },
      {
        kind: "codex",
        text: 'npx rgr sources add "docs/**/*.md" "specs/**/*.md" "src/features/**/*.tsx"',
      },
      { kind: "output", textKey: "demo_dev_out_sources" },
      { kind: "codex", text: "npx rgr doctor --fix" },
      { kind: "success", textKey: "demo_dev_out_indexed", holdMs: 1500 },
      {
        kind: "codex",
        text: "Use Ragmir to brief requirements, implementation scope, and E2E coverage.",
      },
      { kind: "mcp", text: 'ragmir_search("confidential spec onboarding acceptance criteria")' },
      { kind: "citation", text: "[1] .ragmir/raw/confidential-cdc-v4.pdf:12" },
      { kind: "mcp", text: 'ragmir_search("existing auth components route guard tests")' },
      { kind: "citation", text: "[2] docs/auth-architecture.md:7" },
      { kind: "insight", textKey: "demo_dev_out_brief", holdMs: 1800 },
      { kind: "change", text: "+ docs/evidence-brief.md" },
      { kind: "change", text: "+ tests/e2e/confidential-onboarding.spec.ts" },
      { kind: "success", textKey: "demo_dev_out_done", holdMs: 1800 },
    ],
  },
  {
    id: "aviation",
    titleKey: "demo_scenario_aviation_title",
    descriptionKey: "demo_scenario_aviation_description",
    terminalTitle: "zsh | ~/projects/air-ops-ui",
    badge: "Codex + MCP",
    lines: [
      { kind: "shell", text: "cd ~/projects/air-ops-ui" },
      { kind: "shell", text: "codex" },
      { kind: "output", textKey: "demo_aviation_out_codex_ready" },
      { kind: "codex", text: "ls" },
      { kind: "tree", text: "README.md  package.json  src/  docs/  tests/" },
      { kind: "tree", text: "src/features/slot-swap/  docs/dispatch-rules.md" },
      { kind: "codex", text: "npm install -D @jcode.labs/ragmir" },
      { kind: "output", textKey: "demo_out_added_dependency" },
      { kind: "codex", text: "npx rgr setup --agents codex" },
      { kind: "output", textKey: "demo_out_setup_codex" },
      { kind: "codex", text: "mkdir -p .ragmir/raw && cp ~/Desktop/slot-swap-cdc.md .ragmir/raw/" },
      { kind: "output", textKey: "demo_aviation_out_raw_copy", holdMs: 1400 },
      {
        kind: "codex",
        text: 'npx rgr sources add "docs/**/*.md" "src/features/**/*.tsx"',
      },
      { kind: "output", textKey: "demo_aviation_out_sources" },
      { kind: "codex", text: "npx rgr doctor --fix" },
      { kind: "success", textKey: "demo_aviation_out_indexed", holdMs: 1500 },
      {
        kind: "codex",
        text: "Use Ragmir to explain Slot Swap, then add Playwright E2E tests.",
      },
      { kind: "mcp", text: 'ragmir_search("Slot Swap alternate fuel reserve")' },
      { kind: "citation", text: "[1] .ragmir/raw/slot-swap-cdc.md:18" },
      { kind: "insight", textKey: "demo_aviation_out_requirement", holdMs: 1800 },
      { kind: "mcp", text: 'ragmir_search("flight board route and approvals")' },
      { kind: "citation", text: "[2] docs/dispatch-rules.md:9" },
      { kind: "change", text: "+ tests/e2e/slot-swap.spec.ts" },
      { kind: "change", textKey: "demo_aviation_out_tests" },
      { kind: "success", textKey: "demo_aviation_out_done", holdMs: 1800 },
    ],
  },
  {
    id: "security",
    titleKey: "demo_scenario_security_title",
    descriptionKey: "demo_scenario_security_description",
    terminalTitle: "zsh | ~/projects/policy-api",
    badge: "RFP",
    lines: [
      { kind: "shell", text: "cd ~/projects/policy-api" },
      { kind: "shell", text: "codex" },
      { kind: "output", textKey: "demo_security_out_codex_ready" },
      { kind: "codex", text: "ls" },
      { kind: "tree", text: "README.md  src/  docs/security/  docs/sla.md" },
      { kind: "codex", text: "npx rgr setup --agents codex" },
      { kind: "output", textKey: "demo_out_setup_codex" },
      { kind: "codex", text: "mkdir -p .ragmir/raw && cp ~/Downloads/acme-rfp.xlsx .ragmir/raw/" },
      { kind: "output", textKey: "demo_security_out_raw_copy", holdMs: 1400 },
      { kind: "codex", text: 'npx rgr sources add "docs/security/**/*.md" "docs/sla.md"' },
      { kind: "output", textKey: "demo_security_out_sources" },
      { kind: "codex", text: "npx rgr doctor --fix" },
      { kind: "success", textKey: "demo_security_out_indexed", holdMs: 1500 },
      {
        kind: "codex",
        text: "Draft the encryption, retention, and incident answers with citations.",
      },
      { kind: "mcp", text: 'ragmir_search("RFP encryption retention incident response")' },
      { kind: "citation", text: "[1] .ragmir/raw/acme-rfp.xlsx:4" },
      { kind: "mcp", text: 'ragmir_search("security controls retention SLA")' },
      { kind: "citation", text: "[2] docs/security/data-controls.md:11" },
      { kind: "insight", textKey: "demo_security_out_answer", holdMs: 1800 },
      { kind: "change", text: "+ .ragmir/reports/acme-rfp-response.md" },
      { kind: "success", textKey: "demo_security_out_done", holdMs: 1800 },
    ],
  },
  {
    id: "incident",
    titleKey: "demo_scenario_incident_title",
    descriptionKey: "demo_scenario_incident_description",
    terminalTitle: "zsh | ~/projects/incident-console",
    badge: "Runbook",
    lines: [
      { kind: "shell", text: "cd ~/projects/incident-console" },
      { kind: "shell", text: "codex" },
      { kind: "output", textKey: "demo_incident_out_codex_ready" },
      { kind: "codex", text: "ls" },
      { kind: "tree", text: "src/  tests/  docs/runbooks/  docs/adr/  package.json" },
      { kind: "codex", text: "npx rgr setup --agents codex" },
      { kind: "output", textKey: "demo_out_setup_codex" },
      {
        kind: "codex",
        text: "mkdir -p .ragmir/raw && cp ~/Desktop/incident-2417-notes.md .ragmir/raw/",
      },
      { kind: "output", textKey: "demo_incident_out_raw_copy", holdMs: 1400 },
      {
        kind: "codex",
        text: 'npx rgr sources add "docs/runbooks/**/*.md" "docs/adr/**/*.md"',
      },
      { kind: "output", textKey: "demo_incident_out_sources" },
      { kind: "codex", text: "npx rgr doctor --fix" },
      { kind: "success", textKey: "demo_incident_out_indexed", holdMs: 1500 },
      { kind: "codex", text: "Find the retry storm cause and patch the guardrail." },
      { kind: "mcp", text: 'ragmir_search("retry storm idempotency runbook")' },
      { kind: "citation", text: "[1] docs/runbooks/retry-storm.md:22" },
      { kind: "citation", text: "[2] .ragmir/raw/incident-2417-notes.md:6" },
      { kind: "insight", textKey: "demo_incident_out_cause", holdMs: 1800 },
      { kind: "change", text: "+ src/lib/retry-budget.ts" },
      { kind: "change", text: "+ tests/e2e/retry-storm.spec.ts" },
      { kind: "success", textKey: "demo_incident_out_done", holdMs: 1800 },
    ],
  },
  {
    id: "legal",
    titleKey: "demo_scenario_legal_title",
    descriptionKey: "demo_scenario_legal_description",
    terminalTitle: "zsh | ~/projects/founder-desk",
    badge: "Legal",
    lines: [
      { kind: "shell", text: "cd ~/projects/founder-desk" },
      { kind: "shell", text: "codex" },
      { kind: "output", textKey: "demo_legal_out_codex_ready" },
      { kind: "codex", text: "ls" },
      { kind: "tree", text: "README.md  docs/contracts/  docs/tax/  templates/  package.json" },
      { kind: "codex", text: "npx rgr setup --agents codex,claude" },
      { kind: "output", textKey: "demo_legal_out_setup" },
      {
        kind: "codex",
        text: "mkdir -p .ragmir/raw && cp ~/Desktop/lease-renewal-notes.pdf .ragmir/raw/",
      },
      { kind: "output", textKey: "demo_legal_out_raw_copy", holdMs: 1400 },
      {
        kind: "codex",
        text: 'npx rgr sources add "docs/contracts/**/*.md" "docs/tax/**/*.md"',
      },
      { kind: "output", textKey: "demo_legal_out_sources" },
      { kind: "codex", text: "npx rgr doctor --fix" },
      { kind: "success", textKey: "demo_legal_out_indexed", holdMs: 1500 },
      {
        kind: "codex",
        text: "Compare renewal obligations with the tax memo and draft a cited brief.",
      },
      { kind: "mcp", text: 'ragmir_search("lease renewal notice VAT deposit deadline")' },
      { kind: "citation", text: "[1] .ragmir/raw/lease-renewal-notes.pdf:7" },
      { kind: "mcp", text: 'ragmir_search("tax memo furnished office lease VAT")' },
      { kind: "citation", text: "[2] docs/tax/vat-position.md:14" },
      { kind: "insight", textKey: "demo_legal_out_risk", holdMs: 1800 },
      { kind: "change", text: "+ .ragmir/reports/lease-renewal-brief.md" },
      { kind: "success", textKey: "demo_legal_out_done", holdMs: 1800 },
    ],
  },
  {
    id: "content",
    titleKey: "demo_scenario_content_title",
    descriptionKey: "demo_scenario_content_description",
    terminalTitle: "zsh | ~/projects/channel-research",
    badge: "Research",
    lines: [
      { kind: "shell", text: "cd ~/projects/channel-research" },
      { kind: "shell", text: "codex" },
      { kind: "output", textKey: "demo_content_out_codex_ready" },
      { kind: "codex", text: "ls" },
      { kind: "tree", text: "episodes/  sources/  scripts/  notes/  package.json" },
      { kind: "codex", text: "npx rgr setup --agents codex,kimi" },
      { kind: "output", textKey: "demo_content_out_setup" },
      {
        kind: "codex",
        text: "mkdir -p .ragmir/raw && cp ~/Downloads/interview-transcript.md .ragmir/raw/",
      },
      { kind: "output", textKey: "demo_content_out_raw_copy", holdMs: 1400 },
      {
        kind: "codex",
        text: 'npx rgr sources add "sources/**/*.md" "notes/**/*.md" "episodes/**/*.md"',
      },
      { kind: "output", textKey: "demo_content_out_sources" },
      { kind: "codex", text: "npx rgr doctor --fix" },
      { kind: "success", textKey: "demo_content_out_indexed", holdMs: 1500 },
      {
        kind: "codex",
        text: "Build a 7-minute episode outline from cited passages only.",
      },
      { kind: "mcp", text: 'ragmir_search("habit loop aviation checklist attention")' },
      { kind: "citation", text: "[1] sources/behavioral-systems.md:31" },
      { kind: "citation", text: "[2] .ragmir/raw/interview-transcript.md:12" },
      { kind: "insight", textKey: "demo_content_out_angle", holdMs: 1800 },
      { kind: "change", text: "+ scripts/episode-014-outline.md" },
      { kind: "success", textKey: "demo_content_out_done", holdMs: 1800 },
    ],
  },
  {
    id: "local",
    titleKey: "demo_scenario_local_title",
    descriptionKey: "demo_scenario_local_description",
    terminalTitle: "zsh | ~/projects/offline-lab",
    badge: "Local",
    lines: [
      { kind: "shell", text: "cd ~/projects/offline-lab" },
      { kind: "shell", text: "opencode" },
      { kind: "output", textKey: "demo_local_out_agent_ready" },
      { kind: "codex", text: "ls" },
      { kind: "tree", text: "README.md  docs/  evals/  src/  package.json" },
      { kind: "codex", text: "npx rgr setup --agents opencode" },
      { kind: "output", textKey: "demo_local_out_setup" },
      {
        kind: "codex",
        text: "mkdir -p .ragmir/raw && cp ~/Desktop/model-risk-review.md .ragmir/raw/",
      },
      { kind: "output", textKey: "demo_local_out_raw_copy", holdMs: 1400 },
      { kind: "codex", text: 'npx rgr sources add "docs/**/*.md" "evals/**/*.md"' },
      { kind: "output", textKey: "demo_local_out_sources" },
      { kind: "codex", text: "npx rgr doctor --fix" },
      { kind: "success", textKey: "demo_local_out_indexed", holdMs: 1500 },
      {
        kind: "codex",
        text: "Ask the local model for the approval gate using only cited context.",
      },
      { kind: "mcp", text: 'ragmir_ask("What must pass before offline deployment?")' },
      { kind: "citation", text: "[1] .ragmir/raw/model-risk-review.md:5" },
      { kind: "citation", text: "[2] evals/red-team-gates.md:18" },
      { kind: "insight", textKey: "demo_local_out_gate", holdMs: 1800 },
      { kind: "change", text: "+ docs/offline-approval-checklist.md" },
      { kind: "success", textKey: "demo_local_out_done", holdMs: 1800 },
    ],
  },
]

export const DEFAULT_HERO_DEMO_SCENARIO = HERO_DEMO_SCENARIOS[0]

export function findHeroDemoScenario(id: string): HeroDemoScenario {
  return HERO_DEMO_SCENARIOS.find((scenario) => scenario.id === id) ?? DEFAULT_HERO_DEMO_SCENARIO
}

// Files the repository keeps as exact copies of one canonical source. `pnpm public:smoke` fails when
// a copy drifts; the Claude Code hooks edit the source and refresh the copies.
export const CANONICAL_COPIES = new Map([
  ["llms.txt", ["packages/ragmir-landing/public/llms.txt"]],
  [
    "packages/ragmir-core/skills/ragmir/SKILL.md",
    ["plugins/ragmir/skills/ragmir/SKILL.md", "skills/ragmir/SKILL.md"],
  ],
  ["gemini-extension.json", ["qwen-extension.json"]],
])

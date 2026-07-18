# Quick start

Ragmir requires Node.js 22 or later. Choose the guided setup for a repository-aware installation,
or use the manual commands below.

<!-- ragmir-setup-prompt:start -->
<details>
<summary><strong>Option 1: paste this into your coding agent</strong></summary>

~~~text
Set up Ragmir in this repository. Work interactively: inspect first, ask one concise numbered batch of questions, wait for my answers, then execute. Never assume consent for dependency changes, model downloads, replacing skills, or sharing data.

Outcome: Core installed with the repository's package manager; useful sources selected; secrets and generated noise excluded; tools connected; cited retrieval verified. Semantic retrieval, team features, Chat, and TTS are optional.

1. Inspect without changes:
- Find the repository or monorepo root. Read package.json packageManager, lockfiles, workspace and Node/version-manager files, .gitignore, existing .ragmir state, README, AGENTS/CLAUDE/CODEX guidance, docs, specs/ADRs, apps/packages, important config, source, and tests.
- Detect Node 22+ and pnpm, npm, Yarn, or Bun. Prefer packageManager, then the lockfile. Respect workspace-root flags and mise/asdf/Volta. Never create a second lockfile. If signals conflict, ask.
- If Ragmir exists, inspect its version, config, status, sources, and rgr upgrade --check before changing it.

2. Ask only what the repository did not answer, then wait:
1) Which repository/monorepo base should own the knowledge base, and are nested app bases wanted?
2) Which clients: Claude Code, Codex, Kimi, OpenCode, Cline, another MCP client, or none?
3) Keep default offline local-hash, or allow one semantic-model download for better natural-language retrieval?
4) Solo or team use? If team, what Git/Drive/folder revision is authoritative and who may receive metadata-only snapshots?
5) Core only, or optional Chat? For Chat choose lite (~0.49 GB), fast (~3.35 GB), or quality (~5.15 GB).
6) Optional TTS? Ask language (en/fr/es offline; ja/th/zh require explicit Edge unless a local model is supplied) and whether text may reach Edge.
7) Which private/external folders are allowed, which must never be indexed, and may I install packages, edit local config, and run approved downloads now?

3. Implement after approval:
- Install @jcode.labs/ragmir as a dev dependency with the detected manager. Install Chat/TTS only if selected, at a compatible version.
- Run the matching rgr setup --no-ingest --agents <selected> command. Keep project scope. If a same-name skill is unmanaged, show the diff and ask before --force.
- Build a narrow .ragmir/config.json. Prefer stable relative globs for root guidance, docs/specs/ADRs, package READMEs/manifests, useful app config, and source/tests that explain behavior. Include locales only when useful.
- Exclude .env*, credentials, keys, unapproved dumps/customer data, dependencies, generated/build/cache/coverage/log folders, vendored code, binaries/media, and .ragmir storage/models. In monorepos, keep nested bases scoped and shared knowledge at root.
- Run preview and audit --unsupported before ingest. Review redactions, unsupported/oversized files, duplicates, chunks, and sensitive paths. Fix config first, then ingest.
- For an existing install, use rgr upgrade and doctor --fix as indicated. Never delete the active index first. Rebuild only for incompatible embedding, chunk, or index-policy changes.
- Enable semantic retrieval, preload Chat, or preload TTS only after consent. Use non-sensitive TTS preload text.
- For teams, ingest locally, create an ignored metadata-only snapshot, compare it, explain every drift, and never choose authority automatically.

4. Prove the result:
- Run rgr doctor --deep, rgr audit --unsupported, and rgr security-audit.
- Run representative searches with citations and --explain. Create a small local golden suite for project questions and run rgr evaluate; do not weaken gates to pass.
- Report detected tools, answers, packages, downloads, config/sources/exclusions, changed files, readiness, retrieval results, team status, and exact remaining actions.

Never commit .ragmir, corpus files, models, snapshots, logs, or secrets. Never claim offline, semantic, team synchronization, or retrieval quality without evidence.
~~~

</details>
<!-- ragmir-setup-prompt:end -->

The agent must inspect first, ask once, and wait for approval before it installs dependencies,
downloads models, replaces skills, or shares metadata.

## Manual setup

Install Core in the project that owns the files:

~~~bash
pnpm add -D @jcode.labs/ragmir
pnpm exec rgr setup --agents codex,claude,kimi,opencode,cline
pnpm exec rgr sources add "README.md" "docs/**/*.md"
pnpm exec rgr ingest
pnpm exec rgr search "Which decision changed the rollout?"
~~~

Use the package manager already declared by the project. Ragmir detects pnpm, npm, Yarn, and Bun.
At a pnpm workspace root, add the workspace-root flag. Never create a second lockfile.

Generated configuration, indexes, helpers, reports, and metadata-only logs stay under ignored
`.ragmir/` state. Run `rgr doctor --deep`, `rgr audit --unsupported`, and
`rgr security-audit` before relying on retrieval.

For an existing installation, update the package, run `rgr upgrade --check`, then run `rgr upgrade`
when requested. Ragmir preserves the active index until a validated replacement is ready.

Next: [CLI reference](./cli-reference.md), [configuration](./configuration.md),
[agent integration](./agent-integration.md), [Chat](./offline-chat-preload.md), and
[TTS](./offline-tts-preload.md).

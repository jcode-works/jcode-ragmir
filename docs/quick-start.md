# Quick start

Ragmir requires Node.js 22 or later. Choose the guided setup for a repository-aware installation,
or use the manual commands below.

<!-- ragmir-setup-prompt:start -->
<details>
<summary><strong>Option 1: paste this into your coding agent</strong></summary>

~~~text
Set up Ragmir in this repository. Work interactively: inspect first, infer safe defaults, present a proposal, wait for approval, then execute. Never assume consent for dependency changes, model downloads, replacing skills, or sharing data.

Outcome: Core installed with the repository's package manager; useful sources selected; secrets and generated noise excluded; tools connected; cited retrieval verified. Semantic retrieval, team features, Chat, and TTS are optional.

1. Inspect without changes:
- Find the repository or monorepo root. Read package.json packageManager, lockfiles, workspace and Node/version-manager files, .gitignore, existing .ragmir state, README, AGENTS/CLAUDE/CODEX guidance, docs, specs/ADRs, apps/packages, important config, source, and tests.
- Detect Node 22+ and pnpm, npm, Yarn, or Bun. Prefer packageManager, then the lockfile. Respect workspace-root flags and mise/asdf/Volta. Never create a second lockfile. If signals conflict, ask.
- If Ragmir exists, inspect its version, config, status, sources, and rgr upgrade --check before changing it.

2. Propose one setup summary, then ask once:
- Infer the owning base and useful clients from the repository. State any nested bases you propose.
- Default to offline local-hash and Core only, or optional Chat only when requested. Optional TTS stays off unless requested. Semantic, Chat, and TTS downloads require explicit approval; Edge text transfer requires separate approval.
- Default to solo unless the repository or request shows a team workflow. For a Git-backed team, propose the current upstream as authority and safe automatic pulls; offer --no-pull when Git updates must stay manual.
- List selected source globs, exclusions, any external/private folder, and the exact package, config, skill, and download actions you would perform.
- Ask only about unresolved choices that materially change source authority, data exposure, downloads, or external execution. Wait for one approval covering the proposal.

3. Implement after approval:
- Install @jcode.labs/ragmir as a dev dependency with the detected manager. Install Chat/TTS only if selected, at a compatible version.
- Run the matching rgr setup --no-ingest --agents <selected> command. Keep project scope. If a same-name skill is unmanaged, show the diff and ask before --force.
- Build a narrow .ragmir/config.json. Prefer stable relative globs for root guidance, docs/specs/ADRs, package READMEs/manifests, useful app config, and source/tests that explain behavior. Include locales only when useful.
- Exclude .env*, credentials, keys, unapproved dumps/customer data, dependencies, generated/build/cache/coverage/log folders, vendored code, binaries/media, and .ragmir storage/models. In monorepos, keep nested bases scoped and shared knowledge at root.
- Run preview and audit --unsupported before ingest. Review redactions, unsupported/oversized files, duplicates, chunks, and sensitive paths. Fix config first, then ingest.
- For an existing install, use rgr upgrade and doctor --fix as indicated. Never delete the active index first. Rebuild only for incompatible embedding, chunk, or index-policy changes.
- Enable semantic retrieval, preload Chat, or preload TTS only after consent. Use non-sensitive TTS preload text.
- For Git teams, run rgr team sync. It safely pulls and ingests; --no-pull keeps Git manual. Snapshots are advanced diagnostics.

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

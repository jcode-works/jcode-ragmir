# Ragmir Chat

[![npm version](https://img.shields.io/npm/v/@jcode.labs/ragmir-chat)](https://www.npmjs.com/package/@jcode.labs/ragmir-chat)
[![npm downloads](https://img.shields.io/npm/dm/@jcode.labs/ragmir-chat)](https://www.npmjs.com/package/@jcode.labs/ragmir-chat)
[![Node.js](https://img.shields.io/node/v/@jcode.labs/ragmir-chat)](https://www.npmjs.com/package/@jcode.labs/ragmir-chat)
[![MIT](https://img.shields.io/npm/l/@jcode.labs/ragmir-chat)](https://github.com/jcode-works/jcode-ragmir/blob/main/LICENSE)

**Let an agent or automation delegate cited answer generation to a verified local model.**

`@jcode.labs/ragmir-chat` runs a verified local model through `node-llama-cpp`. It receives passages
retrieved by Ragmir Core, asks the model to answer only from that evidence, and validates the source
markers in the visible answer.

Ragmir does not require this package or any model to retrieve evidence. Use Core with your preferred
AI or automation, and add Chat only when answer generation also needs to stay on the workstation.

[Ragmir overview](https://github.com/jcode-works/jcode-ragmir#readme) ·
[Documentation](https://github.com/jcode-works/jcode-ragmir/wiki) ·
[Offline chat guide](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/offline-chat-preload.md) ·
[Core package](https://www.npmjs.com/package/@jcode.labs/ragmir)

## What this package does

| It does | It does not |
| --- | --- |
| Generate from source passages supplied by the caller | Discover or index project documents by itself |
| Run inference from a local GGUF model | Call a hosted chat API |
| Verify downloaded model size and SHA-256 | Download a model during normal answer generation |
| Report citation validity and model metadata | Guarantee that a small local model is factually correct |

Install Ragmir Core for ingestion, search, MCP, and agent helpers. Install Chat only when you want a
local synthesis step after retrieval.

## Use it from Codex or another AI

```bash
npm install --save-dev @jcode.labs/ragmir @jcode.labs/ragmir-chat
npx rgr setup --agents codex,claude,kimi,opencode,cline
npx rgr sources add "README.md" "docs/**/*.md"
npx rgr ingest
npx rgr chat setup --profile fast
```

Then ask the selected agent:

```text
Use Ragmir to answer the release question with the local Chat profile. Verify the citation status
and expand the cited source before you recommend an action.
```

The agent can run `npx rgr chat "What changed in the release policy?" --profile fast --offline`.
Core retrieves the passages first, then Chat generates from those passages and validates the visible
source markers. For a fully local workflow, use a local agent or automation runner. A hosted agent
still receives the final answer it displays under that provider's data policy.

For self-hosted n8n, CI, or a shell worker, add `--json` so the next step can branch on
`emptyContext` and `citationStatus`. Do not auto-approve a high-impact action unless the status is
`valid` and the workflow has checked the returned sources. n8n Cloud does not provide the Execute
Command node required to launch the local CLI, and self-hosted n8n 2.x disables it by default.

## First cited local answer

Requires Node.js 20 or later and enough disk and memory for the selected model.

```bash
npm install --save-dev @jcode.labs/ragmir @jcode.labs/ragmir-chat
npx rgr setup
npx rgr sources add "README.md" "docs/**/*.md"
npx rgr ingest
npx rgr chat setup --profile fast
npx rgr chat "What evidence supports this decision?" --profile fast --offline
```

The setup command downloads and verifies one model under `.ragmir/models/chat/<profile>`. Normal
chat commands require that prepared local file and never enable remote model resolution.

## Choose a profile

Profiles are implementation choices for this optional package. They are not requirements of
Ragmir Core, the CLI, the TypeScript API, or the MCP server.

| Profile | Model family | Choose it for |
| --- | --- | --- |
| `lite` | Qwen2.5 0.5B | Lower-memory machines and short evidence summaries |
| `fast` | Gemma 4 E2B | Default balance of local quality and resource use |
| `quality` | Gemma 4 E4B | Larger local model, enabled only when explicitly selected |

Inspect and verify a prepared profile before relying on it offline:

```bash
npx rgr chat doctor --profile fast --verify
```

The runtime selects an available Metal, CUDA, Vulkan, or CPU backend. `doctor` reports the selected
backend and whether hardware acceleration is available.

## Use the standalone CLI

Applications that already own their retrieval layer can provide a context file directly:

```bash
npm install --save-dev @jcode.labs/ragmir-chat
npx rgr-chat setup --profile lite
npx rgr-chat answer "What changed?" --context ./retrieved-context.txt --profile lite
```

Standalone commands:

| Command | Purpose |
| --- | --- |
| `rgr-chat setup` | Download and verify a selected model |
| `rgr-chat doctor` | Inspect runtime, model, manifest, size, and optional hash validity |
| `rgr-chat answer` | Generate from a supplied context file |
| `rgr-chat serve` | Start the local line-delimited JSON chat server |

## TypeScript API

Prepare the profile once, then pass retrieved passages to `generateChatAnswer`:

```ts
import { generateChatAnswer, setupChatModel } from "@jcode.labs/ragmir-chat"

await setupChatModel({ profile: "lite" })

const result = await generateChatAnswer({
  question: "What changed in the rollout?",
  profile: "lite",
  sources: [
    {
      relativePath: "docs/rollout.md",
      chunkIndex: 0,
      text: "The rollout moved from Friday to Monday after the review.",
    },
  ],
})

console.log(result.answer)
console.log(result.citationStatus)
```

The result includes the answer, sources, profile, model path, citation status, cited source numbers,
invalid citations, stop reason, and thought-token count. Raw model thought is never returned.

## Citation behavior

The system prompt treats source blocks as untrusted evidence. Instructions found inside retrieved
documents are not followed. The model is asked to cite claims with bracketed source numbers such as
`[1]`, and the package validates those markers after generation.

If no usable source passage is supplied, the package returns an insufficient-context answer without
loading a model. If evidence is incomplete, callers should retrieve better sources instead of asking
the model to guess.

## Offline and air-gapped use

1. Run `rgr chat setup --profile <profile>` on a connected machine.
2. Verify it with `rgr chat doctor --profile <profile> --verify`.
3. Copy the complete profile directory into `.ragmir/models/chat/<profile>` on the target machine.
4. Run the same verification command before using `--offline`.

Normal generation is local and rejects `allowRemoteModels: true`. The only intended network boundary
is the explicit setup step on a connected machine.

## Privacy notes

- Retrieved passages are passed to the local model process on the same machine.
- Visible answers keep citation markers; raw model thought is not shown, logged, or stored.
- Model manifests pin source, revision, file name, size, license, and SHA-256.
- Model output still needs human review when decisions are high stakes.

## Further reading

- [Project documentation](https://github.com/jcode-works/jcode-ragmir/wiki)
- [Complete TypeScript API reference](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/api-reference.md#chat-cited-local-generation)
- [Offline chat preparation](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/offline-chat-preload.md)
- [Ragmir configuration](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/configuration.md)
- [Troubleshooting](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/troubleshooting.md)
- [Ragmir Core on npm](https://www.npmjs.com/package/@jcode.labs/ragmir)
- [Ragmir TTS on npm](https://www.npmjs.com/package/@jcode.labs/ragmir-tts)

Ragmir Chat is open source under the [MIT License](https://github.com/jcode-works/jcode-ragmir/blob/main/LICENSE).
The selected GGUF models have their own pinned Apache 2.0 license metadata.

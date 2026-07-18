# @jcode.labs/ragmir-chat

[![npm version](https://img.shields.io/npm/v/@jcode.labs/ragmir-chat)](https://www.npmjs.com/package/@jcode.labs/ragmir-chat)
[![npm downloads](https://img.shields.io/npm/dm/@jcode.labs/ragmir-chat)](https://www.npmjs.com/package/@jcode.labs/ragmir-chat)
[![Node.js](https://img.shields.io/node/v/@jcode.labs/ragmir-chat)](https://www.npmjs.com/package/@jcode.labs/ragmir-chat)
[![MIT](https://img.shields.io/npm/l/@jcode.labs/ragmir-chat)](https://github.com/jcode-works/jcode-ragmir/blob/main/LICENSE)

Optional cited answer generation with a verified local GGUF model. Ragmir Chat accepts passages
retrieved by Core, generates on the workstation, and validates visible citation markers. It does
not discover or index project files.

[Project overview](https://github.com/jcode-works/jcode-ragmir#readme) ·
[Offline Chat guide](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/offline-chat-preload.md) ·
[API](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/api-reference.md#chat-cited-local-generation)

## Set up and answer

Requires Node.js 22 or later and enough disk and memory for the selected model.

```bash
npm install --save-dev @jcode.labs/ragmir @jcode.labs/ragmir-chat
npx rgr setup
npx rgr sources add "README.md" "docs/**/*.md"
npx rgr ingest
npx rgr chat setup --profile fast
npx rgr chat "What evidence supports this decision?" --profile fast --offline
```

Setup downloads and verifies one model under `.ragmir/models/chat/<profile>`. Normal generation
uses that local file and rejects remote model resolution.

| Profile | Pinned model | Download | Choose it when |
| --- | --- | --- | --- |
| `lite` | Qwen2.5 0.5B Q4_K_M | about 0.49 GB | Memory and startup matter most; thinking stays off |
| `fast` | Gemma 4 E2B Q4_0 | about 3.35 GB | You want the balanced default |
| `quality` | Gemma 4 E4B Q4_0 | about 5.15 GB | You accept a larger model for stronger answers |

Use the same profile for setup, doctor, and generation. These are Chat profiles, not requirements
of Ragmir Core, its CLI, API, or MCP server. Verify offline readiness with
`npx rgr chat doctor --profile fast --verify`.

## TypeScript API

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

console.log(result.answer, result.citationStatus)
```

No usable source returns an insufficient-context result without loading a model. Results include
citation validity and model metadata; raw model thought is never returned or persisted. Human
review remains necessary for high-impact decisions. Applications with another retrieval layer can
use `rgr-chat answer --context <file>`; `rgr-chat serve` is a local line-delimited JSON process, not
an HTTP server.

Model setup may download public weights, never project documents. Normal generation sends retrieved
passages only to the local model process. Keep models and outputs under ignored `.ragmir/` paths.

Ragmir Chat is open source under the [MIT License](https://github.com/jcode-works/jcode-ragmir/blob/main/LICENSE).
Selected GGUF models keep their own pinned license metadata.

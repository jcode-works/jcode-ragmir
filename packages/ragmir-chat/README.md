# Ragmir Chat

`@jcode.labs/ragmir-chat` is the optional local synthesis add-on used by `rgr chat`.
Ragmir Core stays retrieval-only; this package turns cited Ragmir passages into an
answer with a verified Qwen2.5 or Gemma 4 GGUF through `node-llama-cpp`, without Ollama, Python, or a hosted
model API.

```bash
npm install --save-dev @jcode.labs/ragmir @jcode.labs/ragmir-chat
rgr setup
rgr chat setup
rgr chat "What evidence supports this decision?"
```

`rgr chat setup` is the explicit online preload step. Normal answers are strictly
local and cannot download a model. The downloaded GGUF is checked against its
official byte size and SHA256 before a manifest is written under
`.ragmir/models/chat/<profile>/manifest.json`.

## Official profiles

| Profile | Model | Exact size | Pinned revision | SHA256 |
| --- | --- | ---: | --- | --- |
| `lite` | [Qwen2.5 0.5B Instruct Q4_K_M](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF) | 491,400,032 bytes | `9217f5db79a29953eb74d5343926648285ec7e67` | `74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db` |
| `fast` (default) | [Gemma 4 E2B IT QAT Q4_0](https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf) | 3,349,514,112 bytes | `69536a21d70340464240401ba38223d805f6a709` | `3646b4c147cd235a44d91df1546d3b7d8e29b547dbe4e1f80856419aa455e6fd` |
| `quality` | [Gemma 4 E4B IT QAT Q4_0](https://huggingface.co/google/gemma-4-E4B-it-qat-q4_0-gguf) | 5,154,939,136 bytes | `7edc6763a77bbca236126a361613b834c5ea0f7a` | `e8b6a059ba86947a44ace84d6e5679795bc41862c25c30513142588f0e9dba1d` |

```bash
rgr-chat setup                       # fast E2B
rgr-chat setup --profile lite        # 491 MB Qwen2.5 for older computers
rgr-chat setup --profile quality     # quality E4B, explicit opt-in
rgr-chat doctor                      # quick manifest, file-size, and runtime checks
rgr-chat doctor --verify             # also recompute the full GGUF SHA256
```

`doctor --json` also reports `platform`, `arch`, `supportedBackends`, `selectedBackend`, and
`hardwareAcceleration`. The same verified GGUF uses Metal on Apple Silicon, CUDA or Vulkan on
supported Linux/Windows machines, and a packaged CPU backend when that is what the installation
provides. Runtime loading uses `gpu: "auto"`, `build: "never"`, and `skipDownload: true`, so an
answer never compiles or downloads a backend.

MLX is intentionally not a second Mac default. MLX-LM requires Python, and MLX Swift would add a
separate native bridge plus a second Safetensors model supply chain. The current Metal path remains
the production macOS backend until an isolated A/B benchmark proves enough benefit to justify that
complexity.

The package source is MIT licensed. The downloaded Qwen and Google model weights are
separate Apache-2.0 assets; every generated manifest records its pinned source and license URL.

## Grounded answers and thinking

Gemma runs with an 8,192-token context, automatic GPU offload, memory mapping,
and requests flash attention where supported. `standard` thinking is the default. `off`, `standard`, and
`deep` reserve 0, 256, and 768 thought tokens respectively. Thought text is
never returned, streamed, written to the manifest, or kept in visible history.
Only a reasoning state and token count are exposed.

The `lite` profile uses a 4,096-token context, defaults to 256 visible answer tokens, caps output at
512 tokens, and always disables thinking. The smaller limits are intentional for old and low-memory
computers. Citation validation remains identical, but its 0.5B model quality is lower than Gemma 4,
so important answers require closer review.

Ragmir passages are clearly delimited and treated as untrusted evidence. The
system prompt instructs Gemma never to follow instructions found inside a source.
Generated citations are validated against the passages actually sent to the
model: valid references are reported, out-of-range references are removed, and a
missing citation is reported instead of silently appending `[1]`.

```ts
import { generateChatAnswer } from "@jcode.labs/ragmir-chat"

const result = await generateChatAnswer({
  question: "What was approved?",
  thinking: "standard",
  history: [{ role: "user", content: "Focus on the latest review." }],
  sources: [
    {
      relativePath: "reviews/decision.md",
      chunkIndex: 3,
      text: "The review board approved the offline deployment.",
    },
  ],
})

console.log(result.answer, result.citationStatus, result.citations)
```

## Persistent NDJSON server

The Tauri sidecar and other local clients can keep the native runtime loaded
instead of reloading the GGUF for every turn:

```bash
rgr-chat serve --profile fast --offline
```

Write one JSON request per stdin line:

```json
{"id":"turn-1","type":"generate","question":"What was approved?","history":[],"sources":[{"relativePath":"reviews/decision.md","chunkIndex":3,"text":"The board approved offline deployment."}],"thinking":"standard"}
{"id":"cancel-1","type":"cancel","targetId":"turn-1"}
{"id":"shutdown-1","type":"shutdown"}
```

Stdout contains NDJSON events only: `loading`, `reasoning`, `delta`, `completed`,
`cancelled`, or `error`. Reasoning events never contain thought text. Only one
generation runs at a time; a concurrent request receives `BUSY`. Native runtime
diagnostics go to stderr so stdout remains safe for protocol parsing.

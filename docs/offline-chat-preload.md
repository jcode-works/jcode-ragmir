# Offline Local Chat Preload

`rgr chat` uses the optional `@jcode.labs/ragmir-chat` add-on. Ragmir Core remains retrieval-only:
it returns cited passages, while the add-on runs verified Qwen2.5 or Google Gemma 4 GGUF models
locally through `node-llama-cpp` 3.19.

Ragmir Chat is available for desktop and CLI workflows. Android chat is deferred until the native
runtime and packaging path are implemented and verified. The current path requires no Ollama server,
Python runtime, or hosted LLM API.

## Platform Acceleration

Ragmir uses one verified GGUF per profile across desktop platforms. `node-llama-cpp` selects the
best compatible backend already installed for the current operating system and architecture:

| Platform | Preferred backend | Offline package behavior |
| --- | --- | --- |
| macOS Apple Silicon | Metal | Uses the prebuilt `mac-arm64-metal` binding. |
| macOS Intel | CPU with Accelerate | Metal is not enabled by default because llama.cpp support is limited on Intel Macs. |
| Linux x64 with NVIDIA | CUDA | Uses CUDA when the matching driver and prebuilt binding are available. |
| Linux x64 with AMD or Intel GPU | Vulkan | Uses Vulkan when the driver and prebuilt binding are available. |
| Windows x64 with NVIDIA | CUDA | Uses CUDA when the matching driver and prebuilt binding are available. |
| Windows x64 with AMD or Intel GPU | Vulkan | Uses Vulkan when the driver and prebuilt binding are available. |
| Other supported machines | CPU | Uses the platform CPU binding when that binding is installed. |

Normal answers keep `build: "never"` and `skipDownload: true`. Ragmir therefore never compiles or
downloads a different native backend while answering confidential questions. `rgr chat doctor
--json` reports the actual `platform`, `arch`, `supportedBackends`, `selectedBackend`, and
`hardwareAcceleration` values. Do not infer a fallback that doctor does not report.

### Why MLX Is Not A Second Default On Mac

[MLX-LM](https://github.com/ml-explore/mlx-lm) is optimized for Apple Silicon and supports Gemma 4,
but its maintained runtime is a Python package. Adding it would break Ragmir Chat's no-Python
runtime boundary and require a separate MLX Safetensors download.

[MLX Swift LM 3.31.3](https://github.com/ml-explore/mlx-swift-lm/releases/tag/3.31.3) introduced
native Gemma 4 E2B/E4B support. It remains a future Mac-only benchmark candidate, not a
production backend in this tranche: Ragmir would need a Swift bridge, a second verified model
manifest, streaming/cancellation parity, thought-segment filtering, and citation regression tests.
The portable GGUF path already uses Metal on Apple Silicon and preserves one model supply chain for
macOS, Linux, and Windows. Upstream still tracks separate Gemma 4 gaps for speculative drafting and
larger variants in [issue #282](https://github.com/ml-explore/mlx-swift-lm/issues/282).

## Choose A Profile

| Profile | Model | Download size | Use it when |
| --- | --- | ---: | --- |
| `lite` | Qwen2.5 0.5B Instruct Q4_K_M GGUF | 491 MB | The computer is old, CPU-only, or memory constrained. |
| `fast` | Gemma 4 E2B QAT GGUF | 3.35 GB | You want the default, lighter local chat path. |
| `quality` | Gemma 4 E4B QAT GGUF | 5.15 GB | The computer has enough storage and memory for stronger local synthesis. |

The sizes above are model-file download sizes, not runtime memory guarantees. Actual speed and memory
use depend on the computer, context size, and selected thinking mode. `lite` uses a 4,096-token
context, defaults to 256 visible answer tokens, caps generation at 512 tokens, and forces thinking
off. Those limits reduce memory and CPU time but also reduce synthesis quality.

The built-in profiles pin immutable Hugging Face revisions rather than following `main`:

- `lite` Qwen2.5: `9217f5db79a29953eb74d5343926648285ec7e67`;
- `fast` E2B: `69536a21d70340464240401ba38223d805f6a709`;
- `quality` E4B: `7edc6763a77bbca236126a361613b834c5ea0f7a`.

## Run The Explicit Setup

Run setup from the target repository after `rgr setup` and `rgr ingest`:

```bash
rgr chat setup
```

The default command selects the `fast` profile. These two commands are equivalent:

```bash
rgr chat setup
rgr chat setup --profile fast
```

Select the larger model explicitly when local quality matters more than footprint:

```bash
rgr chat setup --profile quality
```

Select the ultra-light model explicitly on an older computer:

```bash
rgr chat setup --profile lite
```

Setup is the only normal chat workflow that downloads a model. It stores each profile separately:

```plain text
.ragmir/models/chat/lite/
.ragmir/models/chat/fast/
.ragmir/models/chat/quality/
```

Each profile directory contains the GGUF and a `manifest.json` with these fields:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Manifest schema version, currently `1`. |
| `provider` | Local provider, `node-llama-cpp`. |
| `runtimeVersion` | Pinned runtime contract, `3.19.0`. |
| `profile` | `lite`, `fast`, or `quality`. |
| `modelId`, `revision` | Model identity and immutable Hugging Face revision. |
| `modelUri`, `downloadUrl` | Pinned model source used by explicit setup. |
| `sourceUrl` | Official Hugging Face repository for the selected profile. |
| `license`, `licenseUrl` | `Apache-2.0` and the official license URL for the selected model. |
| `fileName` | GGUF path relative to the profile directory. |
| `bytes`, `sha256` | Expected exact file size and SHA-256 digest. |
| `verifiedAt` | Time at which setup completed integrity verification. |

The manifest never stores an absolute project path.

Setup must finish the download, verify the exact size and SHA-256 digest, and write the manifest
before it reports the profile ready. An interrupted, truncated, or mismatched file is not ready.

## Verify Readiness

Check the default profile without generating an answer:

```bash
rgr chat doctor
```

Check a specific profile or request machine-readable output:

```bash
rgr chat doctor --profile lite
rgr chat doctor --profile fast
rgr chat doctor --profile quality --verify --json
```

Normal doctor checks the `node-llama-cpp` runtime, the expected pinned manifest, model-file existence,
and exact byte size. It does not hash a multi-gigabyte model on every readiness check. Add `--verify`
for a full SHA-256 pass; JSON output then exposes `modelHashValid`. Use the full verification after a
transfer or when file integrity is in doubt. The same report names the native compute backend that
normal generation will use.

## Generate An Offline Answer

After setup, normal answers use only the verified local GGUF. The explicit `--offline` flag also
documents that network access is not allowed for the answer:

```bash
rgr chat "Which evidence supports offline operation?" --offline
```

Choose the amount of local reasoning with `--thinking`:

```bash
rgr chat "Question" --profile lite --thinking off --offline
rgr chat "Question" --profile fast --thinking off --offline
rgr chat "Question" --profile fast --thinking standard --offline
rgr chat "Question" --profile quality --thinking deep --offline
```

- `off` skips the reasoning budget for the quickest path.
- `standard` is the normal bounded reasoning mode.
- `deep` allocates a larger bounded reasoning budget and can take longer.

The `lite` profile always normalizes thinking to `off`, even if a caller requests another mode.

Raw thought text is never displayed, returned, stored, or logged. Only user-visible messages, the
question and final answer, may enter local chat history. Ragmir validates citation markers against
the retrieved source list before returning the answer, but a valid citation does not prove that the
model interpreted the passage correctly. Review important claims against the cited source text.

Other useful options remain available:

```bash
rgr chat "Question" --top-k 5
rgr chat "Question" --max-new-tokens 256
rgr chat "Question" --context-limit 6000
```

## Prepare An Air-Gapped Machine

On an internet-connected preparation machine, run setup for every profile the offline machine needs:

```bash
rgr chat setup --profile lite
rgr chat setup --profile fast
rgr chat setup --profile quality
```

Copy the complete selected profile directory, including its GGUF and `manifest.json`, into the same
ignored `.ragmir/models/chat/<profile>/` path on the offline machine. Then verify it locally:

```bash
rgr chat doctor --profile lite --verify
rgr chat "Question" --profile lite --thinking off --offline
rgr chat doctor --profile fast --verify
rgr chat "Question" --profile fast --thinking standard --offline
```

Do not copy a partial download or recreate the manifest by hand. Doctor must verify the transferred
file against the recorded size and SHA-256 digest.

## Internal Transport

`rgr-chat serve` is the persistent strict stdio JSONL transport used internally by desktop
integration. Requests enter through stdin and protocol events leave through stdout. It is not the
user chat workflow; use `rgr chat ...` for setup, diagnosis, and answers. Core `rgr chat` imports the
package API for a one-shot answer and does not require this server. Internal thought text is never
exposed as a transport event.

## Files And Licenses

Keep `.ragmir/models/chat/` ignored and never commit GGUF files or their local manifests. Ragmir's
tracked source remains MIT-licensed. The downloaded Gemma 4 weights are separate Apache-2.0 assets
and are not part of the Ragmir source package. The Qwen2.5 `lite` weights are also separate
Apache-2.0 assets. Every manifest records the pinned official source and license URL.

# Offline answer generation

Ragmir Chat is the optional path for corpora whose retrieved passages must not be sent to a hosted
AI. It generates cited answers from Ragmir retrieval context on the same workstation. Ragmir Core,
the CLI, TypeScript API, and MCP server do not require Chat or any particular model.

## Prepare one profile

```bash
rgr chat setup --profile fast
rgr chat doctor --profile fast --verify
rgr chat "What evidence supports this decision?" --profile fast --offline
```

| Profile | Pinned model | Download | Thinking | Use |
| --- | --- | --- | --- | --- |
| `lite` | Qwen2.5 0.5B Q4_K_M | ~0.49 GB | Off | Lower-memory machines and short answers. |
| `fast` | Gemma 4 E2B Q4_0 | ~3.35 GB | Standard or deep | Balanced default. |
| `quality` | Gemma 4 E4B Q4_0 | ~5.15 GB | Standard or deep | Larger explicit quality option. |

Use the same profile in all three commands. Setup downloads and verifies the selected GGUF under
`.ragmir/models/chat/<profile>`. Normal answers use that local file and do not download or build a
runtime. `lite` forces `--thinking off`; `fast` is the default when no profile is provided.

These are Chat implementation profiles, not Ragmir Core requirements. You can use Core with your
preferred AI, a local model runner, a deterministic application, or no generative model at all.

## Air-gapped use

Prepare and verify the profile on a connected machine, copy the complete profile directory into the
same ignored local path, then rerun `rgr chat doctor --profile <profile> --verify` before using
`--offline`.

## Operational rules

- The runtime selects Metal, CUDA, Vulkan, or CPU from its packaged backends automatically.
- Visible answers retain citations; raw model thought is never shown, logged, or stored.
- Use an external agent only when sending retrieved passages to that agent is acceptable for the corpus.

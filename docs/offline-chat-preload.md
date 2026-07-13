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

| Profile | Use |
| --- | --- |
| `lite` | Smaller Qwen2.5 profile for lower-memory machines. |
| `fast` | Default Gemma 4 profile for a stronger local answer. |
| `quality` | Larger Gemma 4 profile, explicit opt-in. |

Setup downloads and verifies the selected GGUF under `.ragmir/models/chat/<profile>`. Normal answers use that local file and do not download or build a runtime.

These are Chat implementation profiles, not Ragmir Core requirements. You can use Core with your
preferred AI, a local model runner, a deterministic application, or no generative model at all.

## Air-gapped use

Prepare and verify the profile on a connected machine, copy the complete profile directory into the same ignored local path, then rerun `rgr chat doctor --verify` before using `--offline`.

## Operational rules

- The runtime selects its packaged acceleration backend automatically.
- Visible answers retain citations; raw model thought is never shown, logged, or stored.
- Use an external agent only when sending retrieved passages to that agent is acceptable for the corpus.

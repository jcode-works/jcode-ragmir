# Offline chat

Ragmir Chat is optional local generation over cited retrieval context. It does not change Ragmir Core’s retrieval-only behavior.

## Prepare one profile

```bash
rgr chat setup --profile fast
rgr chat doctor --profile fast --verify
rgr chat "What evidence supports this decision?" --profile fast --offline
```

| Profile | Use |
| --- | --- |
| `lite` | Smaller Qwen2.5 profile for lower-memory machines. |
| `fast` | Default Gemma 4 profile. |
| `quality` | Larger Gemma 4 profile, explicit opt-in. |

Setup downloads and verifies the selected GGUF under `.ragmir/models/chat/<profile>`. Normal answers use that local file and do not download or build a runtime.

## Air-gapped use

Prepare and verify the profile on a connected machine, copy the complete profile directory into the same ignored local path, then rerun `rgr chat doctor --verify` before using `--offline`.

## Operational rules

- The runtime selects its packaged acceleration backend automatically.
- Visible answers retain citations; raw model thought is never shown, logged, or stored.
- Use an external agent only when sending retrieved passages to that agent is acceptable for the corpus.

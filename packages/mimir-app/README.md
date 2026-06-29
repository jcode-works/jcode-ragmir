# Mimir App

Private Tauri desktop/mobile shell for Mimir.

Root `pnpm build` validates the Vite frontend bundle. Native desktop/mobile builds stay explicit:

```bash
pnpm --filter @jcode.labs/mimir-app tauri:dev
pnpm --filter @jcode.labs/mimir-app tauri:build
pnpm --filter @jcode.labs/mimir-app tauri:ios:init
pnpm --filter @jcode.labs/mimir-app tauri:ios:dev
pnpm --filter @jcode.labs/mimir-app tauri:android:init
pnpm --filter @jcode.labs/mimir-app tauri:android:dev
```

The app uses `@jcode.labs/mimir-ui` for shared styling and should keep privacy controls visible by
default.

Mimir Core integration is a bounded native Tauri command around the existing `mimir` CLI/MCP
surface. In local native runs, set `MIMIR_CLI_BIN` when the `mimir` binary is not on `PATH`. See
[`../../docs/app-sidecar-architecture.md`](../../docs/app-sidecar-architecture.md).

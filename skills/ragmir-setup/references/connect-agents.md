# Connect an agent to Ragmir

Ragmir's MCP server runs over stdio with `rgr serve-mcp`. Every entry below serves one project:
replace `/absolute/project` with the project root. A server registered for every project answers
every workspace from this one base, so register it at project scope where the client allows.

## Agents that `rgr setup --agents` prepares

`rgr setup --agents <list>` writes these helpers into `.ragmir/` and explains them in
`.ragmir/agent-setup.md`.

| Agent | Connect |
| --- | --- |
| Claude Code | From the project root: `claude mcp add-json --scope local ragmir "$(cat .ragmir/claude-mcp-server.json)"`. For a team, commit the same entry in `.mcp.json`; each person approves it once. |
| Codex | Copy `.ragmir/codex-mcp.toml` into the project's `.codex/config.toml`. Codex loads it once the project is trusted. |
| Kimi Code CLI | `kimi --mcp-config-file .ragmir/kimi-mcp.json` |
| OpenCode | Merge `.ragmir/opencode.jsonc` into the project's `opencode.json`. |
| Cline | Merge `.ragmir/cline-mcp.json` into Cline's MCP settings. |

A nested monorepo base gets its own server name, such as `ragmir-apps-web` for `apps/web`; use
the name and commands that `.ragmir/agent-setup.md` shows for that base.

## Other MCP clients

The generic entry runs the project's own Ragmir install through the generated runner:

```json
{
  "mcpServers": {
    "ragmir": {
      "command": "node",
      "args": ["/absolute/project/.ragmir/run.cjs", "serve-mcp"],
      "env": { "RAGMIR_PROJECT_ROOT": "/absolute/project" }
    }
  }
}
```

| Client | Where the entry goes |
| --- | --- |
| Cursor | `.cursor/mcp.json` in the project, with the `mcpServers` shape above. |
| VS Code (GitHub Copilot) | `.vscode/mcp.json` in the project, under `servers` instead of `mcpServers`, with `"type": "stdio"`. `${workspaceFolder}` can replace the absolute path. |
| Gemini CLI | `.gemini/settings.json` in the project, with the `mcpServers` shape above. |
| Windsurf, Claude Desktop | Their global MCP file. Keep `RAGMIR_PROJECT_ROOT` pinned to the project, and set `mcpAllowedRoots` in the base's configuration if other workspaces must be refused. |

VS Code example:

```json
{
  "servers": {
    "ragmir": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/.ragmir/run.cjs", "serve-mcp"],
      "env": { "RAGMIR_PROJECT_ROOT": "${workspaceFolder}" }
    }
  }
}
```

## Plugins

Plugins bundle the MCP server with a pinned Ragmir release; the project still needs sources and
an index (setup steps 3 and 4).

| Agent | Install |
| --- | --- |
| Claude Code | `/plugin install ragmir --marketplace jcode-works/ragmir`, then `/ragmir:index` |
| Codex | `codex plugin marketplace add jcode-works/ragmir`, then `codex plugin add ragmir@ragmir` |
| Gemini CLI | `gemini extensions install https://github.com/jcode-works/ragmir` |
| Qwen Code | `qwen extensions install jcode-works/ragmir:ragmir` |

## Docker

Without Node.js, the client starts the official image. Keep `-i`, which the server needs for
stdin, and use absolute paths, since MCP configuration files do not expand shell variables:

```json
{
  "mcpServers": {
    "ragmir": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-v", "/absolute/project:/workspace",
        "ghcr.io/jcode-works/ragmir", "serve-mcp"
      ]
    }
  }
}
```

On Linux, add `"--user", "<uid>:<gid>"` (from `id -u` and `id -g`) so the files Ragmir writes
under `.ragmir/` belong to the user.

## Check the connection

1. Reload or restart the client, and approve the server if the client asks.
2. Call `ragmir_status`: it names the base, its root, and whether it is ready.
3. Call `ragmir_search` with a question the sources answer and check the citation.
4. `rgr doctor` lists the Ragmir servers registered in Claude Code and Codex and warns about
   servers registered for every project and about unapproved project servers.

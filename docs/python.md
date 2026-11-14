# Use Ragmir from Python

Python applications reach Ragmir through its MCP server or the CLI's JSON output, so LangChain,
LlamaIndex, and plain Python scripts get the same index, exact citations, and refusals as Claude
Code or Codex. No Python package is required. Every example below was run against a Ragmir 6.5
base with Python 3.12, `mcp` 2.3 and 1.30, `langchain-mcp-adapters` 0.3.2, and
`llama-index-tools-mcp` 0.7.

## Prepare the project

Install Ragmir in the project that owns the documents, select its sources, and index them:

```bash
npm install -D @jcode.labs/ragmir
npx rgr init
npx rgr sources add "docs/**/*.md" "docs/**/*.pdf" "docs/**/*.docx"
npx rgr ingest
```

Without Node.js, run the same commands through the [Docker image](#without-nodejs).

## MCP Python SDK

```bash
pip install mcp
```

```python
import asyncio
import json

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

server = StdioServerParameters(command="npx", args=["rgr", "serve-mcp"], cwd="/path/to/project")


async def main() -> None:
    async with stdio_client(server) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(
                "ragmir_search", {"query": "where are attachment permissions stored"}
            )
            for passage in json.loads(result.content[0].text):
                print(passage["citation"], passage["snippet"])


asyncio.run(main())
```

The server exposes `ragmir_search`, `ragmir_expand`, `ragmir_status`, and `ragmir_audit`. Search
returns three compact citations by default; call `ragmir_expand` with a citation to read the full
passage.

## LangChain

```bash
pip install langchain-mcp-adapters
```

```python
from langchain_mcp_adapters.client import MultiServerMCPClient

client = MultiServerMCPClient(
    {
        "ragmir": {
            "transport": "stdio",
            "command": "npx",
            "args": ["rgr", "serve-mcp"],
            "cwd": "/path/to/project",
        }
    }
)
tools = await client.get_tools()
```

Pass `tools` to your LangChain or LangGraph agent. The agent decides when to search, expands the
passages it needs, and answers with your model.

## LlamaIndex

```bash
pip install llama-index-tools-mcp
```

```python
from llama_index.tools.mcp import BasicMCPClient, McpToolSpec

client = BasicMCPClient(
    "npx", args=["rgr", "serve-mcp"], env={"RAGMIR_PROJECT_ROOT": "/path/to/project"}
)
tools = await McpToolSpec(client=client).to_tool_list_async()
```

Give `tools` to a `FunctionAgent` or any LlamaIndex agent.

## Without Node.js

The official image runs the same CLI and MCP server. Mount the project at `/workspace`:

```bash
docker run --rm -v "$PWD:/workspace" --user "$(id -u):$(id -g)" ghcr.io/jcode-works/ragmir init
docker run --rm -v "$PWD:/workspace" --user "$(id -u):$(id -g)" ghcr.io/jcode-works/ragmir \
  sources add "docs/**/*.md"
docker run --rm -v "$PWD:/workspace" --user "$(id -u):$(id -g)" ghcr.io/jcode-works/ragmir ingest
```

Then point any of the clients above at the container:

```python
import os

server = StdioServerParameters(
    command="docker",
    args=[
        "run", "--rm", "-i", "--user", f"{os.getuid()}:{os.getgid()}",
        "-v", "/path/to/project:/workspace", "ghcr.io/jcode-works/ragmir", "serve-mcp",
    ],
)
```

## Scripts and batch jobs

The CLI prints full results as JSON:

```python
import json
import subprocess

completed = subprocess.run(
    ["npx", "rgr", "search", "checkout retry attempts", "--json", "--top-k", "3"],
    cwd="/path/to/project", capture_output=True, text=True, check=True,
)
for passage in json.loads(completed.stdout)["results"]:
    print(passage["citation"], passage.get("weakEvidence", False))
```

## What your application owns

An empty result means the base holds no evidence for the question: let the agent say so instead
of answering from memory. Results flagged `weakEvidence` need checking. Ragmir calls no model and
opens no port; your application chooses the model and decides where passages go. For a service on
a server, see [Run Ragmir on a server](./server-deployment.md).

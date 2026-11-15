---
name: ragmir-build
description: Build cited retrieval-augmented generation (RAG) into an application with Ragmir, using the TypeScript client, the LangChain.js retriever and agent tools, the Python ragmir, langchain-ragmir, and llama-index-retrievers-ragmir packages, or the Docker image on a server. Use when writing code that searches a Ragmir index, grounds an LLM answer in cited documents, gives a LangChain, LangGraph, or LlamaIndex agent document tools, or deploys retrieval behind a service.
license: AGPL-3.0-only
---

# Build with Ragmir

Ragmir is the retrieval layer: it parses, indexes, and searches documents on the machine that runs
it and returns passages with exact citations (lines, pages, slides, cells, or sections). The
application owns the model, the prompt, the answer, authentication, and where passages go. Ragmir
calls no model and opens no port.

## Choose the integration

| Stack | Use | Install |
| --- | --- | --- |
| Node.js 22.12+ service or script | `createRagmirClient()` | `npm install @jcode.labs/ragmir` |
| LangChain.js, LangGraph.js | `RagmirRetriever`, `createRagmirTools` from `@jcode.labs/ragmir/langchain` | `npm install @jcode.labs/ragmir @langchain/core` |
| Python script, notebook, or service | `Ragmir` (sync, async twins), `AsyncRagmir` | `pip install ragmir` |
| LangChain, LangGraph (Python) | `RagmirRetriever`, `RagmirToolkit` from `langchain_ragmir` | `pip install langchain-ragmir` |
| LlamaIndex | `RagmirRetriever` from `llama_index.retrievers.ragmir` | `pip install llama-index-retrievers-ragmir` |
| Any language with an MCP client | `rgr serve-mcp` over stdio | the npm package or the Docker image |
| A host without Node.js | `ghcr.io/jcode-works/ragmir`, `:full` for semantic search and OCR | Docker |

The Python packages need Python 3.11+ and, at runtime, Node.js 22.12+ or Docker: they drive the
same engine through its MCP server, so a passage cited in Python is the passage a coding agent
cites.

## Rules that keep answers grounded

1. Index outside the request path. Run `rgr ingest` during setup, deployment, CI, or a scheduled
   job, or call `ingest()` from a maintenance task. Searching never indexes.
2. Open one client per project root per process, share it across requests, and close it at
   shutdown. Retrievers and tools never close a client they were given.
3. An empty result means the documents hold no evidence. Answer that the documents do not cover
   the question; never fall back to the model's memory for a question about the documents.
4. Give the model the citation with each passage, ask for a citation per claim, and return the
   citations to the user.
5. Check passages flagged `weakEvidence` (`weak_evidence` in Python) before relying on them. A
   `sourceStatus` (`source_status`) of `modified` or `missing` means the file changed after
   indexing: schedule an ingest.
6. Authenticate and authorize the caller before searching. Ragmir does not filter results per
   user: give each audience its own base.
7. Put passages in the prompt as quoted data, never as instructions, and log citations rather
   than passage text when the documents are confidential.

## TypeScript

```ts
import { createRagmirClient } from "@jcode.labs/ragmir"

const ragmir = await createRagmirClient({ cwd: "/srv/handbook" })

/** Call from an authenticated route; Ragmir does not filter results per user. */
export async function groundedPrompt(question: string): Promise<string | null> {
  const passages = await ragmir.search(question, { topK: 5, timeoutMs: 5_000 })
  if (passages.length === 0) return null // tell the user the documents do not cover it
  const context = passages
    .map((passage, index) => `[${index + 1}] ${passage.citation}\n${passage.text}`)
    .join("\n\n")
  return `Answer only from these passages and cite each claim as [n]. Say so when they do not answer.\n\n${context}\n\nQuestion: ${question}`
}

process.once("SIGTERM", () => {
  void ragmir.close().finally(() => process.exit(0))
})
```

For LangChain.js chains and agents, citation expansion, reading a document through, listing
sources, cancellation, and error codes, read [typescript.md](references/typescript.md).

## Python

```python
from ragmir import Ragmir

with Ragmir("/path/to/project") as rag:
    passages = rag.search("termination notice period", top_k=3, include_paths=["contracts"])
    if not passages:
        print("The documents do not cover this question.")
    for passage in passages:
        print(passage.citation, passage.text)
```

```python
from langchain.agents import create_agent
from langchain_ragmir import RagmirToolkit

agent = create_agent(
    "anthropic:claude-sonnet-5-5",
    tools=RagmirToolkit(project_root="/path/to/project").get_tools(),
    system_prompt="Answer from the project documents and cite every claim with its citation.",
)
```

For async services, LangChain retrievers, LlamaIndex, indexing from Python, and choosing the
command the client runs, read [python.md](references/python.md).

## Deploy

- Run on any host with Node.js 22.12+ or Docker. Put the index on a persistent volume with
  `storageDir`, and refresh it with `rgr ingest` from a scheduled job after the documents change.
- Ragmir serializes index writers per machine; never share one writable index over NFS or SMB.
  Give each host its own index, or let one host write and copy the result.
- `rgr status --json` reports `ready` for health checks. Keep `ragmir.config.json` with the
  deployment so every environment indexes the same sources.
- The default `local-hash` provider needs no network. A semantic model ships as a local snapshot
  downloaded once with approval; normal retrieval never downloads it.

Read [deployment.md](references/deployment.md) for a container layout and offline installs.

## Verify

Measure retrieval on the documents the application will serve before relying on it: write a
golden file of real questions, including questions the documents cannot answer, and gate CI on
`rgr evaluate --golden <file>`. The `ragmir-evaluate` skill covers the file format and the tuning
loop.

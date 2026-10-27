import type { McpSeenResults } from "./types.js"

/** A passage already returned in this MCP session: enough to recognize it, not to re-read it. */
export interface SeenCitationStub {
  citation: string
  relativePath: string
  seen: true
  evidence?: { id: string }
}

interface CitedResult {
  citation: string
  relativePath: string
  evidence?: { id: string }
}

/**
 * Citations returned during one MCP connection. Agents fan out related searches and receive the
 * same passages again; a quarter of returned citations were repeats in real sessions, so repeats
 * come back as short stubs (or not at all) and the budget goes to new evidence.
 */
export class McpSessionMemory {
  private readonly citations = new Set<string>()

  get size(): number {
    return this.citations.size
  }

  has(citation: string): boolean {
    return this.citations.has(citation)
  }

  remember(citations: Iterable<string>): void {
    for (const citation of citations) {
      this.citations.add(citation)
    }
  }
}

/**
 * Keep up to `topK` unseen results in rank order. Seen results ranked above the last kept one become
 * stubs in `collapse` mode, disappear in `exclude` mode, and stay whole in `include` mode.
 * `alsoSeen` holds citations returned earlier in the same batch.
 */
export function applySeenResults<Result extends CitedResult>(
  results: readonly Result[],
  memory: McpSessionMemory,
  mode: McpSeenResults,
  topK: number,
  alsoSeen: ReadonlySet<string> = new Set(),
): Array<Result | SeenCitationStub> {
  if (mode === "include") {
    return results.slice(0, topK)
  }
  const selected: Array<Result | SeenCitationStub> = []
  let fresh = 0
  for (const result of results) {
    if (fresh >= topK) {
      break
    }
    if (!memory.has(result.citation) && !alsoSeen.has(result.citation)) {
      selected.push(result)
      fresh += 1
    } else if (mode === "collapse") {
      selected.push({
        citation: result.citation,
        relativePath: result.relativePath,
        seen: true,
        ...(result.evidence === undefined ? {} : { evidence: { id: result.evidence.id } }),
      })
    }
  }
  return selected
}

export function isSeenCitationStub(value: unknown): value is SeenCitationStub {
  return typeof value === "object" && value !== null && "seen" in value && value.seen === true
}

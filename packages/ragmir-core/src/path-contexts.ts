import { pathMatchesFilter } from "./path-globs.js"
import { canonicalUserPath } from "./source-paths.js"
import { memoizeByText } from "./text-memo.js"
import type { Config } from "./types.js"

interface PathContextEntry {
  filter: string
  description: string
}

const resolvers = new Map<string, (relativePath: string) => string | undefined>()

/**
 * What the documents under a path are, as the config describes them: the descriptions of the
 * scopes that include the path and the matching `pathContexts`, most general first. An agent reads
 * it beside each result to weigh a passage ("archived, may be outdated"; "ADR: the newest one
 * wins") before expanding it. It informs and never ranks.
 */
export function pathContextResolver(
  config: Pick<Config, "pathContexts" | "scopes">,
): (relativePath: string) => string | undefined {
  const entries: PathContextEntry[] = [
    ...Object.values(config.scopes).flatMap((scope) =>
      scope.description === undefined
        ? []
        : scope.includePaths.map((filter) => ({ filter, description: scope.description ?? "" })),
    ),
    ...Object.entries(config.pathContexts).map(([filter, description]) => ({
      filter,
      description,
    })),
  ].map((entry) => ({ ...entry, filter: canonicalUserPath(entry.filter) }))
  const key = JSON.stringify(entries)
  let resolve = resolvers.get(key)
  if (!resolve) {
    resolve =
      entries.length === 0
        ? () => undefined
        : memoizeByText((relativePath) => {
            const descriptions = entries
              .filter((entry) => pathMatchesFilter(relativePath, entry.filter))
              // Shorter filters cover more of the tree: general context first, then specifics.
              .sort((left, right) => left.filter.length - right.filter.length)
              .map((entry) => entry.description)
            const unique = [...new Set(descriptions)]
            return unique.length === 0 ? undefined : unique.join("; ")
          })
    resolvers.set(key, resolve)
  }
  return resolve
}

/** Include paths of the scopes kept out of searches that name no scope or path. */
export function defaultExcludedScopePaths(config: Pick<Config, "scopes">): string[] {
  return Object.values(config.scopes).flatMap((scope) =>
    scope.searchByDefault === false ? scope.includePaths : [],
  )
}

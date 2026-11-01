/** Passage texts remembered per memoized function; about 4 MB of text at the default chunk size. */
const MAX_REMEMBERED_TEXTS = 4096

/**
 * Remember a query-independent result per passage text for the whole process. A warm process ranks
 * the same popular passages for many queries, and recomputing their words, defined names, and
 * duplicate keys for each one took a large share of a search. The oldest text leaves first.
 */
export function memoizeByText<T>(
  compute: (text: string) => T,
  capacity = MAX_REMEMBERED_TEXTS,
): (text: string) => T {
  const known = new Map<string, T>()
  return (text) => {
    const cached = known.get(text)
    if (cached !== undefined) {
      return cached
    }
    const value = compute(text)
    if (known.size >= capacity) {
      const oldest = known.keys().next().value
      if (oldest !== undefined) {
        known.delete(oldest)
      }
    }
    known.set(text, value)
    return value
  }
}

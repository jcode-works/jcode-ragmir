// Ingest-heavy tests run about three times slower on Windows. Measured on GitHub runners, spawning
// git costs 16 times more there, an fsync 9 times more, and creating and removing small files 9
// times more, so ingesting the demo corpus takes 409 ms against 147 ms on Linux. Test timeouts are
// calibrated on Linux and macOS, then scaled on Windows; vitest.config.ts scales the defaults.
export const PLATFORM_TIMEOUT_FACTOR = process.platform === "win32" ? 3 : 1

/** Timeout for an integration test that ingests, rebuilds, or migrates an index. */
export function integrationTimeout(milliseconds: number): number {
  return milliseconds * PLATFORM_TIMEOUT_FACTOR
}

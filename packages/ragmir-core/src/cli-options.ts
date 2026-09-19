import type { AgentInstallMode, AgentInstallScope } from "./skill.js"
import type { IncrementalFailurePolicy } from "./types.js"

/** Parse and validate a positive integer CLI argument. */
export function parsePositiveInt(value: string): number {
  const parsed = Number(value)
  // Use Number() (not parseInt) so fractional input like "1.5" is rejected
  // instead of silently truncating to 1, and so non-numeric strings become NaN.
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Expected a positive integer.")
  }
  return parsed
}

/** Parse and validate a non-negative integer CLI argument. */
export function parseNonNegativeInt(value: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("Expected a non-negative integer.")
  }
  return parsed
}

/** Parse and validate a finite number CLI argument. */
export function parseNumber(value: string): number {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) {
    throw new Error("Expected a number.")
  }
  return parsed
}

/** Parse and validate a recall threshold CLI argument in the inclusive range 0..1. */
export function parseRecallThreshold(value: string): number {
  const trimmed = value.trim()
  const parsed = Number(trimmed)
  if (trimmed.length === 0 || !Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error("Expected a recall threshold between 0 and 1.")
  }
  return parsed
}

/** Parse and validate the incremental ingestion failure policy. */
export function parseIncrementalFailurePolicy(value: string): IncrementalFailurePolicy {
  if (value === "preserve-last-good" || value === "remove-stale") {
    return value
  }
  throw new Error("Expected preserve-last-good or remove-stale.")
}

/** Parse and validate the `--scope` agent-install argument. */
export function parseAgentInstallScope(value: string | undefined): AgentInstallScope {
  if (value === "project" || value === "user") {
    return value
  }
  throw new Error("Expected --scope to be project or user.")
}

/** Parse and validate the `--mode` agent-install argument. */
export function parseAgentInstallMode(value: string | undefined): AgentInstallMode {
  if (value === "link" || value === "copy") {
    return value
  }
  throw new Error("Expected --mode to be link or copy.")
}

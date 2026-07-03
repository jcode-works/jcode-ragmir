import { isTtsLanguage, TTS_LANGUAGES, type TtsLanguage } from "@jcode.labs/ragmir-tts"
import type { AgentInstallMode, AgentInstallScope } from "./skill.js"

/**
 * Pure option-parsing and validation helpers for the Ragmir CLI. Kept separate
 * from `cli.ts` (which wires Commander and side effects) so they can be unit
 * tested without spawning a process or importing commander.
 *
 * Each helper either returns the validated value or throws an Error with a
 * user-facing message; the CLI surfaces the message in red on stderr.
 */

export type AudioEngine = "auto" | "edge" | "transformers"

export interface AudioOptions {
  out?: string
  engine?: string
  lang?: string
  offline?: boolean
  allowRemoteModels?: boolean
}

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

/**
 * Resolve the `allowRemoteModels` flag from audio options. Offline mode forces
 * remote model loading off; an explicit opt-in enables it; otherwise undefined
 * lets the TTS package apply its own offline-by-default behaviour.
 */
export function audioAllowRemoteModels(options: AudioOptions): boolean | undefined {
  if (options.offline) {
    return false
  }
  if (options.allowRemoteModels) {
    return true
  }
  return undefined
}

/**
 * Resolve the spoken language from `--lang`. Throws on an unsupported value so
 * the operator is told which languages are available.
 */
export function audioLanguage(options: AudioOptions): TtsLanguage | undefined {
  if (options.lang === undefined) {
    return undefined
  }
  if (isTtsLanguage(options.lang)) {
    return options.lang
  }
  throw new Error(`Expected --lang to be one of: ${TTS_LANGUAGES.join(", ")}.`)
}

/**
 * Resolve the TTS engine from audio options. Offline always forces the local
 * Transformers.js renderer. An MP3 output without an explicit `--engine edge`
 * is rejected as a confidentiality guard: MP3 requires the online Edge TTS
 * service, so the operator must opt in knowingly rather than leak narration
 * text by accident.
 */
export function audioEngine(options: AudioOptions): AudioEngine {
  if (options.offline) {
    return "transformers"
  }
  if (options.engine === undefined) {
    if (options.out?.toLowerCase().endsWith(".mp3")) {
      throw new Error(
        "MP3 output uses online Edge TTS. Re-run with `--engine edge` only when sending narration text to Edge TTS is acceptable.",
      )
    }
    return "transformers"
  }
  if (options.engine === "auto" || options.engine === "edge" || options.engine === "transformers") {
    return options.engine
  }
  throw new Error("Expected --engine to be auto, edge, or transformers.")
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

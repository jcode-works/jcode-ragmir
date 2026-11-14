import { PROJECT_LINK_LABEL_KEYS } from "./project-links"

/** The translation keys one React island reads: whole families by prefix, plus single keys. */
export interface TranslationSelection {
  prefixes?: readonly string[]
  keys?: readonly string[]
}

/**
 * Keeps only the translations an island reads. Astro serializes every island prop into the page,
 * so passing the whole dictionary to each island would repeat it once per island in the HTML.
 */
export function pickTranslations(
  translations: Record<string, string>,
  selection: TranslationSelection,
): Record<string, string> {
  const keys = new Set(selection.keys ?? [])
  const prefixes = selection.prefixes ?? []
  return Object.fromEntries(
    Object.entries(translations).filter(
      ([key]) => keys.has(key) || prefixes.some((prefix) => key.startsWith(prefix)),
    ),
  )
}

export const NAVBAR_TRANSLATIONS: TranslationSelection = {
  prefixes: ["nav_"],
  keys: [
    "hero_github_cta",
    "hero_npm_cta",
    "language_label",
    ...Object.values(PROJECT_LINK_LABEL_KEYS),
  ],
}

export const HERO_DEMO_TRANSLATIONS: TranslationSelection = {
  prefixes: ["demo_"],
  keys: ["copy_command"],
}

export const USE_CASE_TRANSLATIONS: TranslationSelection = {
  prefixes: ["use_case"],
}

export const LIBRARY_TRANSLATIONS: TranslationSelection = {
  prefixes: ["library_", "quickstart_"],
  keys: ["command_copied", "copy_command", "copy_prompt"],
}

export const languages = {
  en: "English",
  fr: "Français",
}

export const defaultLang = "en"
export const locales = Object.keys(languages) as Array<keyof typeof languages>

type Locale = (typeof locales)[number]
type TranslationMap = Record<string, string>

const translations: Partial<Record<Locale, TranslationMap>> = {}

export async function loadTranslations(locale: string): Promise<TranslationMap> {
  const normalizedLocale = normalizeLocale(locale)
  if (!translations[normalizedLocale] || import.meta.env.DEV) {
    switch (normalizedLocale) {
      case "fr":
        translations.fr = (await import("../../messages/fr.json")).default
        break
      case "en":
        translations.en = (await import("../../messages/en.json")).default
        break
    }
  }

  return translations[normalizedLocale] ?? translations.en ?? {}
}

export async function useTranslations(locale: string): Promise<{
  locale: Locale
  t: (key: string) => string
  translations: TranslationMap
}> {
  const normalizedLocale = normalizeLocale(locale)
  const t = await loadTranslations(normalizedLocale)

  return {
    locale: normalizedLocale,
    t: (key: string) => t[key] ?? key,
    translations: t,
  }
}

export function getLocale(astro: { params?: { locale?: string }; currentLocale?: string }): Locale {
  return normalizeLocale(astro.params?.locale ?? astro.currentLocale ?? defaultLang)
}

export function getLocalizedUrl(path: string, locale: string): string {
  if (/^[a-z]+:/iu.test(path)) {
    return path
  }

  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`
  const withTrailingSlash = withLeadingSlash.endsWith("/")
    ? withLeadingSlash
    : `${withLeadingSlash}/`
  return normalizeLocale(locale) === defaultLang
    ? withTrailingSlash
    : `/${locale}${withTrailingSlash}`
}

function normalizeLocale(locale: string): Locale {
  return locales.includes(locale as Locale) ? (locale as Locale) : defaultLang
}

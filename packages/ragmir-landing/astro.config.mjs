import react from "@astrojs/react"
import sitemap from "@astrojs/sitemap"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "astro/config"

const siteUrl = process.env.PUBLIC_RAGMIR_LANDING_URL ?? "https://ragmir.com"
const locales = ["en", "fr", "es", "zh"]
const defaultLocale = "en"
const isProduction = new URL(siteUrl).hostname === "ragmir.com"

export default defineConfig({
  site: siteUrl,
  output: "static",
  server: ({ command }) => ({
    port: command === "preview" ? 4323 : 4322,
  }),
  compressHTML: true,
  i18n: {
    defaultLocale,
    locales,
    routing: {
      prefixDefaultLocale: false,
    },
  },
  integrations: [
    react(),
    ...(isProduction
      ? [
          sitemap({
            // No lastmod: Google uses it only when it is verifiably accurate, and Bing asks not to
            // stamp pages that did not change with the build time, which every release would do.
            // Each URL lists the same alternates as its hreflang links, x-default included.
            serialize: (item) => {
              const english = item.links?.find((link) => link.lang === defaultLocale)
              // The plugin shares one links array between a page's locales: copy, never push.
              return english
                ? { ...item, links: [...item.links, { url: english.url, lang: "x-default" }] }
                : item
            },
            i18n: {
              defaultLocale,
              locales: {
                en: "en",
                fr: "fr",
                es: "es",
                zh: "zh-Hans",
              },
            },
          }),
        ]
      : []),
  ],
  prefetch: {
    prefetchAll: true,
    defaultStrategy: "viewport",
  },
  experimental: {
    // Prerender prefetched links via the Speculation Rules API for faster locale navigation.
    clientPrerender: true,
  },
  vite: {
    plugins: [tailwindcss()],
    envPrefix: ["PUBLIC_"],
  },
})

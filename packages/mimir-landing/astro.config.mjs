import react from "@astrojs/react"
import sitemap from "@astrojs/sitemap"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "astro/config"

const siteUrl = process.env.PUBLIC_MIMIR_LANDING_URL ?? "https://mimir.jcode.works"
const locales = ["en", "fr"]
const defaultLocale = "en"
const isProduction = new URL(siteUrl).hostname === "mimir.jcode.works"

export default defineConfig({
  site: siteUrl,
  output: "static",
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
            lastmod: new Date(),
            serialize(item) {
              const path = new URL(item.url).pathname
              if (/^\/(?:fr\/)?$/.test(path)) {
                return { ...item, changefreq: "weekly", priority: 1.0 }
              }
              return { ...item, priority: 0.5 }
            },
            i18n: {
              defaultLocale,
              locales: {
                en: "en-US",
                fr: "fr-FR",
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
  vite: {
    plugins: [tailwindcss()],
    envPrefix: ["PUBLIC_"],
    ssr: {
      noExternal: ["@jcode.labs/mimir-ui"],
    },
  },
})

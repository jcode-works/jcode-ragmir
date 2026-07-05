import type { APIRoute } from "astro"

const PRODUCTION_DOMAIN = "https://ragmir.com"
const PRODUCTION_HOSTNAME = new URL(PRODUCTION_DOMAIN).hostname

const isProduction =
  siteHostname(import.meta.env.PUBLIC_RAGMIR_LANDING_URL ?? PRODUCTION_DOMAIN) ===
  PRODUCTION_HOSTNAME

const productionRobots = `User-agent: *
Content-Signal: search=yes, ai-input=yes, ai-train=no
Allow: /

Sitemap: ${PRODUCTION_DOMAIN}/sitemap-index.xml

# AI crawlers: see /llms.txt and /ai.txt for product information and citation guidance.
`

const stagingRobots = "User-agent: *\nDisallow: /\n"

export const GET: APIRoute = () => {
  return new Response(isProduction ? productionRobots : stagingRobots, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  })
}

function siteHostname(siteUrl: string): string {
  try {
    return new URL(siteUrl).hostname
  } catch {
    return ""
  }
}

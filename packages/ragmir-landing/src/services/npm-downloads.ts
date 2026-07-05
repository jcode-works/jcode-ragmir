const RAGMIR_PACKAGE_NAME = "@jcode.labs/ragmir"
const NPM_DOWNLOADS_ENDPOINT = `https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(RAGMIR_PACKAGE_NAME)}`
const DOWNLOADS_TIMEOUT_MS = 5000

interface NpmDownloadsPayload {
  downloads: number
  package: string
}

export async function getMonthlyNpmDownloads(): Promise<number | null> {
  const override = parseDownloadsOverride(process.env.RAGMIR_NPM_DOWNLOADS)
  if (override !== null) return override

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), DOWNLOADS_TIMEOUT_MS)

  try {
    const response = await fetch(NPM_DOWNLOADS_ENDPOINT, {
      signal: abortController.signal,
    })

    if (!response.ok) return null

    const payload: unknown = await response.json()
    if (!isNpmDownloadsPayload(payload)) return null

    return payload.downloads
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function isNpmDownloadsPayload(payload: unknown): payload is NpmDownloadsPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "downloads" in payload &&
    typeof payload.downloads === "number" &&
    Number.isFinite(payload.downloads) &&
    payload.downloads >= 0 &&
    "package" in payload &&
    payload.package === RAGMIR_PACKAGE_NAME
  )
}

function parseDownloadsOverride(value: string | undefined): number | null {
  if (!value) return null

  const downloads = Number.parseInt(value, 10)
  return Number.isFinite(downloads) && downloads >= 0 ? downloads : null
}

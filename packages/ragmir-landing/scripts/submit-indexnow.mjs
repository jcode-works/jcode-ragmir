#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseStringPromise } from "xml2js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PRODUCTION_DOMAIN = "https://ragmir.com"
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow"
const BATCH_SIZE = 99
const CACHE_FILE = path.join(__dirname, ".indexnow-cache.json")
const SITEMAP_REMOTE_URL = `${PRODUCTION_DOMAIN}/sitemap-0.xml`
const INDEXNOW_API_KEY = process.env.INDEXNOW_API_KEY ?? ""
const INDEXNOW_KEY_NAME = process.env.INDEXNOW_KEY_NAME ?? ""

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"))
    }
  } catch {
    console.warn("Warning: could not load IndexNow cache, treating all URLs as new")
  }
  return {}
}

function saveCache(urlMap) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(urlMap, null, 2), "utf-8")
  } catch (error) {
    console.warn("Warning: could not save IndexNow cache:", error.message)
  }
}

async function fetchSitemapContent() {
  const localPath = process.env.SITEMAP_LOCAL_PATH
  if (localPath) {
    console.log(`Reading sitemap from local artifact: ${localPath}`)
    if (!fs.existsSync(localPath)) {
      console.error(`Local sitemap not found at: ${localPath}`)
      process.exit(1)
    }
    return fs.readFileSync(localPath, "utf-8")
  }

  console.log(`Fetching sitemap from ${SITEMAP_REMOTE_URL}...`)
  try {
    const response = await fetch(SITEMAP_REMOTE_URL)
    if (!response.ok) {
      console.error(`${SITEMAP_REMOTE_URL} returned HTTP ${response.status}`)
      process.exit(1)
    }
    return await response.text()
  } catch (error) {
    console.error(`Failed to fetch sitemap: ${error.message}`)
    process.exit(1)
  }
}

async function extractUrlsFromSitemap() {
  const sitemapContent = await fetchSitemapContent()
  const parsed = await parseStringPromise(sitemapContent)
  const urlMap = {}
  let hasMissingLastmod = false
  for (const entry of parsed.urlset.url) {
    const url = entry.loc[0]
    const lastmod = entry.lastmod?.[0] ?? null
    hasMissingLastmod ||= lastmod === null
    urlMap[url] = lastmod
  }
  return { urlMap, hasMissingLastmod }
}

function filterModifiedUrls(currentUrls, cachedUrls) {
  const modified = []
  const newUrls = []

  for (const [url, lastmod] of Object.entries(currentUrls)) {
    if (!Object.hasOwn(cachedUrls, url)) {
      newUrls.push({ url, lastmod })
      modified.push(url)
    } else if (lastmod !== null && cachedUrls[url] !== lastmod) {
      modified.push(url)
    }
  }

  return { modified, newUrls }
}

async function submitToIndexNow(urls) {
  if (!INDEXNOW_API_KEY) {
    console.error("INDEXNOW_API_KEY environment variable is not set. Skipping submission.")
    process.exit(0)
  }
  if (!INDEXNOW_KEY_NAME) {
    console.error("INDEXNOW_KEY_NAME environment variable is not set. Skipping submission.")
    process.exit(0)
  }

  const totalUrls = urls.length
  let successCount = 0
  let failureCount = 0

  console.log(`Submitting ${totalUrls} URLs to IndexNow in batches of ${BATCH_SIZE}...`)

  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, Math.min(i + BATCH_SIZE, urls.length))
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1
    const totalBatches = Math.ceil(urls.length / BATCH_SIZE)

    try {
      const payload = {
        host: PRODUCTION_DOMAIN.replace(/^https?:\/\//, ""),
        key: INDEXNOW_API_KEY,
        keyLocation: `${PRODUCTION_DOMAIN}/${INDEXNOW_KEY_NAME}.txt`,
        urlList: batch,
      }

      const response = await fetch(INDEXNOW_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload),
      })

      if (response.status === 200 || response.status === 202) {
        successCount += batch.length
        const statusMsg = response.status === 202 ? " (validation pending)" : ""
        console.log(
          `Batch ${batchNumber}/${totalBatches}: ${batch.length} URLs submitted${statusMsg}`,
        )
      } else {
        failureCount += batch.length
        const errorText = await response.text()
        console.error(`Batch ${batchNumber}/${totalBatches}: Status ${response.status}`)
        if (errorText) console.error(`   Response: ${errorText}`)
      }
    } catch (error) {
      failureCount += batch.length
      console.error(`Batch ${batchNumber}/${totalBatches}: ${error.message}`)
    }

    if (i + BATCH_SIZE < urls.length) {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  console.log(`\nSummary: ${successCount} successful, ${failureCount} failed, ${totalUrls} total`)
  return failureCount === 0
}

async function main() {
  const skipCache = process.argv.includes("--all") || process.argv.includes("--force")
  const clearCache = process.argv.includes("--clear-cache")

  console.log("IndexNow Smart Submission for Ragmir\n")

  const { urlMap: currentUrls, hasMissingLastmod } = await extractUrlsFromSitemap()
  console.log(`Found ${Object.keys(currentUrls).length} URLs in sitemap`)

  if (hasMissingLastmod && !skipCache) {
    console.warn("Sitemap entries omit <lastmod>; use --all after publishing changed pages.")
  }

  const cachedUrls = clearCache ? {} : loadCache()
  console.log(`Cached URLs: ${Object.keys(cachedUrls).length}`)

  if (skipCache) {
    console.log("Mode: Submit ALL URLs (--all flag used)\n")
    const allUrls = Object.keys(currentUrls)
    const success = await submitToIndexNow(allUrls)
    if (success) {
      saveCache(currentUrls)
      console.log(`\nCache updated with ${allUrls.length} URLs`)
    }
  } else {
    const { modified, newUrls } = filterModifiedUrls(currentUrls, cachedUrls)

    if (modified.length === 0) {
      console.log("\nNo changes detected. All URLs are already indexed.")
      return
    }

    console.log(
      `\nChange detection: ${newUrls.length} new, ${modified.length - newUrls.length} modified, ${modified.length} to submit\n`,
    )

    const success = await submitToIndexNow(modified)
    if (success) {
      saveCache(currentUrls)
      console.log(`\nCache updated with ${Object.keys(currentUrls).length} URLs`)
    }
  }

  if (clearCache) {
    console.log("\nCache cleared")
  }
}

main().catch((error) => {
  console.error("Unexpected error:", error)
  process.exit(1)
})

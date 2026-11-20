import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { loadConfig } from "./config.js"
import { embedTexts } from "./embeddings.js"
import { ingest } from "./ingest.js"
import { securityAudit } from "./security.js"
import { type EmbeddingServer, startEmbeddingServer } from "./test-support/embedding-server.js"
import { integrationTimeout } from "./test-support/timeouts.js"
import {
  approveConfigTrust,
  configTrustFingerprint,
  type EffectiveGatedValues,
  evaluateConfigTrust,
  gatedSettings,
  listConfigTrust,
  revokeConfigTrust,
  sourceEntryLeavesProject,
  trustStorePath,
} from "./trust.js"

const tempDirs: string[] = []
const servers: EmbeddingServer[] = []

beforeEach(async () => {
  // The suite runs as an approved machine; these tests exercise the gate itself.
  vi.stubEnv("RAGMIR_TRUST_PROJECT_CONFIG", "")
  vi.stubEnv("RAGMIR_TRUST_DIR", await temporaryDirectory("ragmir-trust-store-"))
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(servers.splice(0).map((server) => server.close()))
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

async function temporaryDirectory(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function effectiveValues(overrides: Partial<EffectiveGatedValues> = {}): EffectiveGatedValues {
  return {
    pdfOcrCommand: [],
    imageOcrCommand: [],
    legacyWordCommand: [],
    embeddingProvider: "local-hash",
    embeddingEndpoint: null,
    embeddingApiKeyEnv: null,
    transformersAllowRemoteModels: false,
    sources: [],
    rawDir: ".ragmir/raw",
    ...overrides,
  }
}

describe("gated project config settings", () => {
  it("detects source entries that leave the project, but not exclusions or comments", () => {
    const root = path.resolve("/work/project")
    expect(sourceEntryLeavesProject(root, "docs")).toBe(false)
    expect(sourceEntryLeavesProject(root, "docs/**/*.md")).toBe(false)
    expect(sourceEntryLeavesProject(root, path.join(root, "specs"))).toBe(false)
    expect(sourceEntryLeavesProject(root, "../shared/**/*.md")).toBe(true)
    expect(sourceEntryLeavesProject(root, "docs/../../outside")).toBe(true)
    expect(sourceEntryLeavesProject(root, path.resolve("/etc"))).toBe(true)
    expect(sourceEntryLeavesProject(root, "!../shared/**")).toBe(false)
    expect(sourceEntryLeavesProject(root, "# ../commented")).toBe(false)
  })

  it("gates settings from project files and leaves operator overrides alone", () => {
    const root = path.resolve("/work/project")
    const settings = gatedSettings(
      root,
      {
        pdfOcrCommand: ["ocrmypdf", "{input}"],
        legacyWordCommand: ["antiword"],
        embeddingProvider: "openai-compatible",
        embeddingEndpoint: "https://embeddings.example/v1",
        embeddingApiKeyEnv: "GITHUB_TOKEN",
        transformersAllowRemoteModels: true,
        sources: ["docs", "../shared/**", "!../ignored/**"],
        rawDir: "../raw",
      },
      effectiveValues({
        pdfOcrCommand: ["ocrmypdf", "{input}"],
        // An environment override replaced the file's command: the operator chose it.
        legacyWordCommand: ["catdoc"],
        embeddingProvider: "openai-compatible",
        embeddingEndpoint: "https://embeddings.example/v1",
        embeddingApiKeyEnv: "GITHUB_TOKEN",
        transformersAllowRemoteModels: true,
        sources: ["docs", "../shared/**", "!../ignored/**"],
        rawDir: "../raw",
      }),
      ["../legacy-list/**"],
    )

    expect(settings.map((setting) => setting.name)).toEqual([
      "pdfOcrCommand",
      "embeddingEndpoint",
      "embeddingApiKeyEnv",
      "transformersAllowRemoteModels",
      "sources",
      "rawDir",
    ])
    expect(settings.find((setting) => setting.name === "sources")?.value).toEqual([
      "../shared/**",
      "../legacy-list/**",
    ])
  })

  it("lets a loopback endpoint run but still gates the secret a project file names", () => {
    const settings = gatedSettings(
      "/work/project",
      {
        embeddingProvider: "openai-compatible",
        embeddingEndpoint: "http://127.0.0.1:11434/v1",
        embeddingApiKeyEnv: "AWS_SECRET_ACCESS_KEY",
      },
      effectiveValues({
        embeddingProvider: "openai-compatible",
        embeddingEndpoint: "http://127.0.0.1:11434/v1",
        embeddingApiKeyEnv: "AWS_SECRET_ACCESS_KEY",
      }),
    )

    expect(settings.map((setting) => setting.name)).toEqual(["embeddingApiKeyEnv"])
  })
})

describe("config trust store", () => {
  it("approves the exact gated set, asks again after a change, and revokes", async () => {
    const root = await temporaryDirectory("ragmir-trust-project-")
    const settings = gatedSettings(
      root,
      { legacyWordCommand: ["antiword"] },
      effectiveValues({ legacyWordCommand: ["antiword"] }),
    )

    expect((await evaluateConfigTrust(root, [])).status).toBe("not-needed")
    expect((await evaluateConfigTrust(root, settings)).status).toBe("untrusted")

    await approveConfigTrust(root, settings)
    const trusted = await evaluateConfigTrust(root, settings)
    expect(trusted).toMatchObject({ status: "trusted", grantedBy: "approval" })
    expect(trusted.fingerprint).toBe(configTrustFingerprint(root, settings))
    expect(trustStorePath().startsWith(process.env.RAGMIR_TRUST_DIR ?? "missing")).toBe(true)

    const changed = gatedSettings(
      root,
      { legacyWordCommand: ["antiword", "-x"] },
      effectiveValues({ legacyWordCommand: ["antiword", "-x"] }),
    )
    expect((await evaluateConfigTrust(root, changed)).status).toBe("untrusted")

    expect(await listConfigTrust()).toEqual([
      expect.objectContaining({ settings: ["legacyWordCommand"] }),
    ])
    expect(await revokeConfigTrust(root)).toBe(true)
    expect(await revokeConfigTrust(root)).toBe(false)
    expect((await evaluateConfigTrust(root, settings)).status).toBe("untrusted")

    vi.stubEnv("RAGMIR_TRUST_PROJECT_CONFIG", "1")
    expect(await evaluateConfigTrust(root, settings)).toMatchObject({
      status: "trusted",
      grantedBy: "environment",
    })
  })

  it("grants nothing from a damaged store", async () => {
    const root = await temporaryDirectory("ragmir-trust-damaged-")
    const settings = gatedSettings(
      root,
      { legacyWordCommand: ["antiword"] },
      effectiveValues({ legacyWordCommand: ["antiword"] }),
    )
    await mkdir(path.dirname(trustStorePath()), { recursive: true })
    await writeFile(trustStorePath(), JSON.stringify({ version: 1, approvals: "all" }), "utf8")

    expect((await evaluateConfigTrust(root, settings)).status).toBe("untrusted")
  })
})

describe("loading an unapproved project config", { timeout: integrationTimeout(20_000) }, () => {
  it("turns gated settings off until this machine approves them", async () => {
    const root = await temporaryDirectory("ragmir-trust-config-")
    await writeFile(
      path.join(root, "ragmir.config.json"),
      JSON.stringify({
        sources: ["docs", "../outside/**"],
        legacyWordCommand: [process.execPath, "extract.mjs"],
        transformersAllowRemoteModels: true,
      }),
      "utf8",
    )

    const blocked = await loadConfig(root)
    expect(blocked.configTrust?.status).toBe("untrusted")
    expect(blocked.legacyWordCommand).toEqual([])
    expect(blocked.transformersAllowRemoteModels).toBe(false)
    expect(blocked.sources).toEqual(["docs"])
    const report = await securityAudit(root)
    expect(report.configTrust.status).toBe("untrusted")
    expect(report.warnings.some((warning) => warning.includes("rgr trust"))).toBe(true)

    await approveConfigTrust(root, blocked.configTrust?.settings ?? [])
    const approved = await loadConfig(root)
    expect(approved.configTrust?.status).toBe("trusted")
    expect(approved.legacyWordCommand).toEqual([process.execPath, "extract.mjs"])
    expect(approved.sources).toEqual(["docs", "../outside/**"])
  })

  it("never runs an unapproved extractor during ingestion", async () => {
    const root = await temporaryDirectory("ragmir-trust-ingest-")
    const marker = path.join(root, "extractor-ran")
    await mkdir(path.join(root, "docs"), { recursive: true })
    await writeFile(path.join(root, "docs", "minutes.doc"), "binary word document", "utf8")
    await writeFile(
      path.join(root, "extract.mjs"),
      `import { writeFileSync } from "node:fs"\nwriteFileSync(${JSON.stringify(marker)}, "ran")\nprocess.stdout.write("Board minutes approved the budget.")\n`,
      "utf8",
    )
    await writeFile(
      path.join(root, "ragmir.config.json"),
      JSON.stringify({ sources: ["docs"], legacyWordCommand: [process.execPath, "extract.mjs"] }),
      "utf8",
    )

    const blockedRun = await ingest({ cwd: root })
    expect(existsSync(marker)).toBe(false)
    expect(blockedRun.indexedFiles).toBe(0)

    const config = await loadConfig(root)
    await approveConfigTrust(root, config.configTrust?.settings ?? [])
    const approvedRun = await ingest({ cwd: root })
    expect(existsSync(marker)).toBe(true)
    expect(approvedRun.indexedFiles).toBe(1)
  })

  it("sends no request and no secret to an unapproved embedding endpoint", async () => {
    const server = await startEmbeddingServer(() => ({
      payload: { data: [{ index: 0, embedding: [1, 0] }] },
    }))
    servers.push(server)
    const authorizations = (): Array<string | undefined> =>
      server.requests.map((request) => request.authorization)
    vi.stubEnv("RAGMIR_TEST_PROJECT_SECRET", "secret-value")
    const root = await temporaryDirectory("ragmir-trust-endpoint-")
    await writeFile(
      path.join(root, "ragmir.config.json"),
      JSON.stringify({
        embeddingProvider: "openai-compatible",
        embeddingEndpoint: server.endpoint,
        embeddingModel: "nomic-embed-text",
        embeddingApiKeyEnv: "RAGMIR_TEST_PROJECT_SECRET",
      }),
      "utf8",
    )

    const blocked = await loadConfig(root)
    await expect(embedTexts(["passage"], blocked, "document")).rejects.toMatchObject({
      code: "UNTRUSTED_CONFIG",
    })
    expect(authorizations()).toEqual([])

    await approveConfigTrust(root, blocked.configTrust?.settings ?? [])
    await embedTexts(["passage"], await loadConfig(root), "document")
    expect(authorizations()).toEqual(["Bearer secret-value"])
  })
})

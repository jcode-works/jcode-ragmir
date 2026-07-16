import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  CHAT_MODEL_PROFILES,
  chatModelProfile,
  inspectChatModel,
  NODE_LLAMA_RUNTIME_VERSION,
  resolveChatModelPaths,
  setupChatModelFiles,
  verifyChatModelFile,
} from "./profiles.js"
import type { ChatModelManifest, ChatModelProfileDefinition } from "./types.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("chat model profiles", () => {
  it("should accept only supported profile names", () => {
    expect(["lite", "fast", "quality"].map(chatModelProfile)).toEqual(["lite", "fast", "quality"])
    expect(() => chatModelProfile("unknown")).toThrow("lite`, `fast`, or `quality")
  })

  it("should resolve relative model paths beneath the project root", async () => {
    const root = await temporaryDirectory("ragmir-chat-paths-")

    expect(resolveChatModelPaths(root, ".ragmir/models/chat", "lite")).toMatchObject({
      modelRoot: path.join(root, ".ragmir/models/chat"),
      profileDirectory: path.join(root, ".ragmir/models/chat/lite"),
      manifestPath: path.join(root, ".ragmir/models/chat/lite/manifest.json"),
    })
  })

  it("should distinguish a missing model from a verified local model", async () => {
    const root = await temporaryDirectory("ragmir-chat-inspect-")
    const definition = smallDefinition()
    const paths = resolveChatModelPaths(root, ".ragmir/models/chat", definition.profile)

    await expect(inspectChatModel(paths, definition, { verifyHash: true })).resolves.toMatchObject({
      manifestExists: false,
      manifestValid: false,
      modelFileExists: false,
      modelSizeValid: false,
      modelHashValid: null,
      ready: false,
    })

    await mkdir(paths.profileDirectory, { recursive: true })
    await writeFile(paths.modelFile, "abc")
    await writeFile(paths.manifestPath, JSON.stringify(modelManifest(definition)), "utf8")

    await expect(inspectChatModel(paths, definition, { verifyHash: true })).resolves.toMatchObject({
      manifestExists: true,
      manifestValid: true,
      modelFileExists: true,
      modelSizeValid: true,
      modelHashValid: true,
      ready: true,
    })
  })

  it("should reject an invalid manifest without trusting a matching model file", async () => {
    const root = await temporaryDirectory("ragmir-chat-manifest-")
    const definition = smallDefinition()
    const paths = resolveChatModelPaths(root, ".ragmir/models/chat", definition.profile)
    await mkdir(paths.profileDirectory, { recursive: true })
    await writeFile(paths.modelFile, "abc")
    await writeFile(paths.manifestPath, "{ invalid json", "utf8")

    await expect(inspectChatModel(paths, definition)).resolves.toMatchObject({
      manifestExists: true,
      manifestValid: false,
      modelFileExists: true,
      modelSizeValid: true,
      ready: false,
      manifest: null,
    })
  })

  it("should remove a model file when its size is invalid", async () => {
    const root = await temporaryDirectory("ragmir-chat-size-")
    const modelFile = path.join(root, "model.gguf")
    await writeFile(modelFile, "too large")

    await expect(verifyChatModelFile(modelFile, smallDefinition())).rejects.toThrow("size mismatch")
    expect(existsSync(modelFile)).toBe(false)
  })

  it("should reject a resolver that writes outside the pinned profile path", async () => {
    const root = await temporaryDirectory("ragmir-chat-resolver-")

    await expect(
      setupChatModelFiles(
        { resolveModel: async () => path.join(root, "unexpected.gguf") },
        {
          cwd: root,
          profile: "lite",
          modelPath: ".ragmir/models/chat",
          allowRemoteModels: true,
        },
      ),
    ).rejects.toThrow("Model resolver returned an unexpected file")
  })
})

async function temporaryDirectory(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirs.push(root)
  return root
}

function smallDefinition(): ChatModelProfileDefinition {
  return {
    ...CHAT_MODEL_PROFILES.lite,
    bytes: 3,
    sha256: createHash("sha256").update("abc").digest("hex"),
  }
}

function modelManifest(definition: ChatModelProfileDefinition): ChatModelManifest {
  return {
    schemaVersion: 1,
    provider: "node-llama-cpp",
    runtimeVersion: NODE_LLAMA_RUNTIME_VERSION,
    profile: definition.profile,
    modelId: definition.modelId,
    revision: definition.revision,
    modelUri: definition.modelUri,
    downloadUrl: definition.downloadUrl,
    sourceUrl: definition.sourceUrl,
    license: definition.license,
    licenseUrl: definition.licenseUrl,
    fileName: definition.fileName,
    bytes: definition.bytes,
    sha256: definition.sha256,
    verifiedAt: "2026-07-16T00:00:00.000Z",
  }
}

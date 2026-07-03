import { webcrypto } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

const args = parseArgs(process.argv.slice(2))
const keyPair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
])
const privateKey = await webcrypto.subtle.exportKey("jwk", keyPair.privateKey)
const publicKey = await webcrypto.subtle.exportKey("jwk", keyPair.publicKey)
const privateKeyPath = args["private-key"] ?? ".ragmir/license-private.jwk"
const publicKeyPath = args["public-key"] ?? ".ragmir/license-public.jwk"
const writtenPrivateKey = await writeKey(privateKeyPath, JSON.stringify(privateKey, null, 2))
const writtenPublicKey = await writeKey(publicKeyPath, JSON.stringify(publicKey, null, 2))

if (args.json) {
  console.log(
    JSON.stringify(
      {
        privateKeyPath: writtenPrivateKey,
        publicKeyPath: writtenPublicKey,
        vitePublicKeyEnv: JSON.stringify(publicKey),
      },
      null,
      2,
    ),
  )
} else {
  console.log(`wrote ${writtenPrivateKey}`)
  console.log(`wrote ${writtenPublicKey}`)
  console.log("Private key material was written to disk and was not printed.")
}

async function writeKey(target, content) {
  const resolved = path.resolve(target)
  await mkdir(path.dirname(resolved), { recursive: true })
  await writeFile(resolved, `${content}\n`, { mode: 0o600 })
  return resolved
}

function parseArgs(values) {
  const parsed = {}
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (!value?.startsWith("--")) continue
    const key = value.slice(2)
    const next = values[index + 1]
    if (!next || next.startsWith("--")) {
      parsed[key] = "true"
      continue
    }
    parsed[key] = next
    index += 1
  }
  return parsed
}

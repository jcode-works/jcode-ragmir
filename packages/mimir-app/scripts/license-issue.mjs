import { licensePayload, parseArgs, readPrivateKey, signLicensePayload } from "./license-core.mjs"

const args = parseArgs(process.argv.slice(2))
const privateKeyJwk = await readPrivateKey(args)
const payload = licensePayload(args)
console.log(await signLicensePayload(payload, privateKeyJwk))

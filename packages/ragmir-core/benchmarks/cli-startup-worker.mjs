import { pathToFileURL } from "node:url"

const [cliPath, ...cliArguments] = process.argv.slice(2)
if (!cliPath) {
  throw new Error("CLI startup worker requires a CLI path.")
}

process.argv = [process.execPath, cliPath, ...cliArguments]
await import(pathToFileURL(cliPath).href)

console.log(
  `RAGMIR_CLI_STARTUP=${JSON.stringify({ maxRssKiB: process.resourceUsage().maxRSS })}`,
)

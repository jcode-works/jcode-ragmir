import { isIP } from "node:net"
import type { Config, HostClassification } from "./types.js"

export function assertNetworkPolicy(config: Config): void {
  const classification = classifyHost(config.ollamaHost)

  if (config.networkPolicy === "allow-any") {
    return
  }

  if (config.networkPolicy === "local-only" && classification.kind !== "loopback") {
    throw new Error(
      `Refusing to send document text to non-local Ollama host "${config.ollamaHost}". Set networkPolicy to "allow-private" or "allow-any" only if this is intentional.`,
    )
  }

  if (
    config.networkPolicy === "allow-private" &&
    classification.kind !== "loopback" &&
    classification.kind !== "private"
  ) {
    throw new Error(
      `Refusing to send document text to remote Ollama host "${config.ollamaHost}". Set networkPolicy to "allow-any" only if this is intentional.`,
    )
  }
}

export function classifyHost(input: string): HostClassification {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return { kind: "invalid", host: input }
  }

  const host = url.hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase()
  if (isLoopbackHost(host)) {
    return { kind: "loopback", host }
  }

  if (isPrivateHost(host)) {
    return { kind: "private", host }
  }

  return { kind: "remote", host }
}

function isLoopbackHost(host: string): boolean {
  if (host === "localhost" || host === "::1") {
    return true
  }

  if (isIP(host) === 4) {
    return host.startsWith("127.")
  }

  return false
}

function isPrivateHost(host: string): boolean {
  if (host === "host.docker.internal" || host.endsWith(".local")) {
    return true
  }

  if (isIP(host) === 4) {
    const parts = host.split(".").map((part) => Number.parseInt(part, 10))
    const [first = 0, second = 0] = parts
    return (
      first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 169 && second === 254)
    )
  }

  if (isIP(host) === 6) {
    return host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")
  }

  return false
}

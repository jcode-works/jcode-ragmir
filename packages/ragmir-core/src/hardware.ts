import { execFile } from "node:child_process"
import os from "node:os"

/** What the machine offers to a local embedding model, read without native add-ons. */
export interface HardwareProfile {
  platform: NodeJS.Platform
  architecture: string
  /** CPU model string from the operating system, or null when it reports none. */
  cpuModel: string | null
  /** Logical CPUs this process may use; respects affinity and container CPU quotas. */
  logicalCpus: number
  /** Memory the process can use: the system total, lowered by a container limit when one applies. */
  memoryBytes: number
  /** Memory available right now, as the runtime reports it; a hint, since caches are reclaimable. */
  availableMemoryBytes: number
  /** `container` when a cgroup memory limit is lower than the system total. */
  memorySource: "system" | "container"
  /** Apple Silicon: unified memory and fast CPU inference for small models. */
  appleSilicon: boolean
  /** An x64 Node.js translated by Rosetta on Apple Silicon: inference runs far slower. */
  rosetta: boolean
}

/** Values at or above this are the runtime's way of saying "no limit". */
const UNLIMITED_MEMORY_BYTES = 2 ** 60

export interface HardwareProbe {
  platform: () => NodeJS.Platform
  architecture: () => string
  cpus: () => Array<{ model: string }>
  availableParallelism: () => number
  totalMemory: () => number
  /** `process.constrainedMemory()`: 0 when unknown or unlimited. */
  constrainedMemory: () => number
  /** `process.availableMemory()`. */
  availableMemory: () => number
  /** Whether an x64 process on macOS runs under Rosetta translation. */
  rosettaTranslated: () => Promise<boolean>
}

const systemProbe: HardwareProbe = {
  platform: () => process.platform,
  architecture: () => process.arch,
  cpus: () => os.cpus(),
  availableParallelism: () => os.availableParallelism(),
  totalMemory: () => os.totalmem(),
  constrainedMemory: () => process.constrainedMemory(),
  availableMemory: () => process.availableMemory(),
  rosettaTranslated: () =>
    new Promise((resolve) => {
      execFile("sysctl", ["-in", "sysctl.proc_translated"], { timeout: 1_000 }, (error, stdout) => {
        resolve(!error && stdout.trim() === "1")
      })
    }),
}

/** Reads the machine's CPU, memory, and container limit. Never throws: unknown values fall back. */
export async function detectHardware(probe: HardwareProbe = systemProbe): Promise<HardwareProfile> {
  const platform = probe.platform()
  const architecture = probe.architecture()
  const totalMemory = probe.totalMemory()
  const constrained = safeNumber(probe.constrainedMemory)
  const limited =
    constrained > 0 && constrained < UNLIMITED_MEMORY_BYTES && constrained < totalMemory
  const memoryBytes = limited ? constrained : totalMemory
  const available = safeNumber(probe.availableMemory)
  const cpuModel = probe.cpus()[0]?.model.trim()
  const rosetta =
    platform === "darwin" && architecture === "x64"
      ? await probe.rosettaTranslated().catch(() => false)
      : false
  return {
    platform,
    architecture,
    cpuModel: cpuModel ? cpuModel : null,
    logicalCpus: Math.max(1, safeNumber(probe.availableParallelism)),
    memoryBytes,
    availableMemoryBytes: available > 0 ? Math.min(available, memoryBytes) : memoryBytes,
    memorySource: limited ? "container" : "system",
    appleSilicon: platform === "darwin" && (architecture === "arm64" || rosetta),
    rosetta,
  }
}

function safeNumber(read: () => number): number {
  try {
    const value = read()
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

/** Formats a byte count as gibibytes with one decimal, such as "7.5 GB", for reports. */
export function formatMemory(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

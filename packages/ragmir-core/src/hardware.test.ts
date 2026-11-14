import { describe, expect, it } from "vitest"
import { detectHardware, formatMemory, type HardwareProbe } from "./hardware.js"

const GIB = 1024 ** 3

function probe(overrides: Partial<HardwareProbe> = {}): HardwareProbe {
  return {
    platform: () => "linux",
    architecture: () => "x64",
    cpus: () => [{ model: "  Example CPU  " }],
    availableParallelism: () => 8,
    totalMemory: () => 32 * GIB,
    constrainedMemory: () => 0,
    availableMemory: () => 20 * GIB,
    rosettaTranslated: async () => false,
    ...overrides,
  }
}

describe("detectHardware", () => {
  it("lowers memory to a container limit", async () => {
    const hardware = await detectHardware(probe({ constrainedMemory: () => 4 * GIB }))

    expect(hardware.memoryBytes).toBe(4 * GIB)
    expect(hardware.availableMemoryBytes).toBe(4 * GIB)
    expect(hardware.memorySource).toBe("container")
    expect(hardware.cpuModel).toBe("Example CPU")
    expect(hardware.logicalCpus).toBe(8)
  })

  it("keeps the system total when the limit is unknown or unlimited", async () => {
    const unknown = await detectHardware(probe())
    const unlimited = await detectHardware(probe({ constrainedMemory: () => 2 ** 64 - 1 }))

    expect(unknown.memoryBytes).toBe(32 * GIB)
    expect(unknown.memorySource).toBe("system")
    expect(unlimited.memoryBytes).toBe(32 * GIB)
    expect(unlimited.availableMemoryBytes).toBe(20 * GIB)
  })

  it("recognizes Apple Silicon and Node.js translated by Rosetta", async () => {
    const native = await detectHardware(
      probe({ platform: () => "darwin", architecture: () => "arm64" }),
    )
    const translated = await detectHardware(
      probe({ platform: () => "darwin", rosettaTranslated: async () => true }),
    )
    const intelMac = await detectHardware(
      probe({ platform: () => "darwin", rosettaTranslated: async () => false }),
    )

    expect(native).toMatchObject({ appleSilicon: true, rosetta: false })
    expect(translated).toMatchObject({ appleSilicon: true, rosetta: true })
    expect(intelMac).toMatchObject({ appleSilicon: false, rosetta: false })
  })

  it("falls back when the runtime reports nothing usable", async () => {
    const hardware = await detectHardware(
      probe({
        cpus: () => [],
        availableParallelism: () => 0,
        availableMemory: () => {
          throw new Error("unsupported")
        },
        rosettaTranslated: () => Promise.reject(new Error("no sysctl")),
      }),
    )

    expect(hardware.cpuModel).toBeNull()
    expect(hardware.logicalCpus).toBe(1)
    expect(hardware.availableMemoryBytes).toBe(32 * GIB)
  })
})

describe("formatMemory", () => {
  it("prints gibibytes with one decimal", () => {
    expect(formatMemory(7.5 * GIB)).toBe("7.5 GB")
  })
})

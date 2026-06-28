import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findProjectRoot, loadConfig } from "./config.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("loadConfig", () => {
  it("resolves project config upward and paths from the project root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jcode-kb-"));
    tempDirs.push(root);
    await writeFile(
      path.join(root, ".kb-config-placeholder"),
      "",
      "utf8",
    );
    await mkdir(path.join(root, ".kb"), { recursive: true });
    await writeFile(
      path.join(root, ".kb/config.json"),
      JSON.stringify({ rawDir: "docs", storageDir: ".kb/index" }),
      "utf8",
    );
    const nested = path.join(root, "packages/app");
    await mkdir(nested, { recursive: true });

    expect(findProjectRoot(nested)).toBe(root);

    const config = await loadConfig(nested);
    expect(config.rawDir).toBe(path.join(root, "docs"));
    expect(config.storageDir).toBe(path.join(root, ".kb/index"));
  });
});

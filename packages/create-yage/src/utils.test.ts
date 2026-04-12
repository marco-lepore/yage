import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  copyTemplateDirectory,
  deriveProjectName,
  inspectDirectory,
  rewriteJson,
  validateProjectName,
} from "./utils.js";

describe("validateProjectName", () => {
  it("accepts typical kebab-case names", () => {
    expect(validateProjectName("my-yage-game")).toBeUndefined();
    expect(validateProjectName("game42")).toBeUndefined();
    expect(validateProjectName("a.b.c")).toBeUndefined();
  });

  it("rejects empty names", () => {
    expect(validateProjectName("")).toBeDefined();
  });

  it("rejects names with uppercase letters", () => {
    expect(validateProjectName("MyGame")).toContain("lowercase");
  });

  it("rejects names starting with dot or underscore", () => {
    expect(validateProjectName(".hidden")).toContain("dot");
    expect(validateProjectName("_foo")).toContain("dot");
  });

  it("rejects names with disallowed characters", () => {
    expect(validateProjectName("my game")).toBeDefined();
    expect(validateProjectName("hello!")).toBeDefined();
  });

  it("rejects names over 214 characters", () => {
    expect(validateProjectName("a".repeat(215))).toContain("214");
  });
});

describe("deriveProjectName", () => {
  it("extracts the last path segment", () => {
    expect(deriveProjectName("/tmp/foo/my-game")).toBe("my-game");
  });

  it("lowercases and strips leading dots/underscores", () => {
    expect(deriveProjectName("/tmp/.hidden")).toBe("hidden");
    expect(deriveProjectName("/tmp/_private")).toBe("private");
  });

  it("replaces invalid characters with hyphens and trims trailing hyphens", () => {
    expect(deriveProjectName("/tmp/My Game!")).toBe("my-game");
  });

  it("falls back to a sensible default", () => {
    expect(deriveProjectName("/")).toBe("my-yage-game");
  });
});

describe("inspectDirectory", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "create-yage-utils-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("reports missing for non-existent paths", () => {
    const state = inspectDirectory(join(workDir, "nope"));
    expect(state.kind).toBe("missing");
  });

  it("reports empty for fresh directories", () => {
    const state = inspectDirectory(workDir);
    expect(state.kind).toBe("empty");
  });

  it("reports non-empty for directories with contents", () => {
    writeFileSync(join(workDir, "hello.txt"), "hi");
    const state = inspectDirectory(workDir);
    expect(state.kind).toBe("non-empty");
    if (state.kind === "non-empty") {
      expect(state.entries).toContain("hello.txt");
    }
  });
});

describe("copyTemplateDirectory", () => {
  let sourceDir: string;
  let targetDir: string;

  beforeEach(() => {
    sourceDir = mkdtempSync(join(tmpdir(), "create-yage-src-"));
    targetDir = mkdtempSync(join(tmpdir(), "create-yage-dst-"));
    rmSync(targetDir, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(sourceDir, { recursive: true, force: true });
    rmSync(targetDir, { recursive: true, force: true });
  });

  it("copies files and renames underscore-prefixed files", async () => {
    writeFileSync(join(sourceDir, "_package.json"), '{"name":"demo"}');
    writeFileSync(join(sourceDir, "_gitignore"), "node_modules\n");
    writeFileSync(join(sourceDir, "index.html"), "<html></html>");
    mkdirSync(join(sourceDir, "src"));
    writeFileSync(join(sourceDir, "src", "main.ts"), "export {};");

    await copyTemplateDirectory(sourceDir, targetDir);

    await expect(readFile(join(targetDir, "package.json"), "utf8")).resolves.toBe(
      '{"name":"demo"}',
    );
    await expect(readFile(join(targetDir, ".gitignore"), "utf8")).resolves.toContain(
      "node_modules",
    );
    await expect(readFile(join(targetDir, "index.html"), "utf8")).resolves.toContain(
      "<html>",
    );
    await expect(
      readFile(join(targetDir, "src", "main.ts"), "utf8"),
    ).resolves.toContain("export");
  });
});

describe("rewriteJson", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "create-yage-json-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("transforms and pretty-prints the file", async () => {
    const file = join(workDir, "package.json");
    writeFileSync(file, '{"name":"old","version":"1.0.0"}');

    await rewriteJson<{ name: string; version: string }>(file, (pkg) => ({
      ...pkg,
      name: "new",
    }));

    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as { name: string; version: string };
    expect(parsed.name).toBe("new");
    expect(parsed.version).toBe("1.0.0");
    expect(raw).toContain("\n"); // pretty-printed
    expect(raw.endsWith("\n")).toBe(true);
  });
});

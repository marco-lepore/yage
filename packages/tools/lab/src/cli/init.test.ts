import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { removeProjects, writeProject } from "../test-helpers.js";
import { HARNESS_FILE, runInit } from "./init.js";

function manifest(dependencies: Record<string, string>): string {
  return JSON.stringify({ name: "game", dependencies });
}

const MINIMAL = manifest({
  "@yagejs/core": "^0.10.0",
  "@yagejs/renderer": "^0.10.0",
});

function harnessIn(dir: string): string {
  return readFileSync(path.join(dir, HARNESS_FILE), "utf8");
}

let written: string[];

beforeEach(() => {
  written = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  removeProjects();
});

describe("runInit", () => {
  it("creates lab/ and writes the harness into it", async () => {
    const cwd = writeProject({ "package.json": MINIMAL });

    await runInit({ cwd, force: false });

    expect(harnessIn(cwd)).toContain("export default defineHarness({");
  });

  // The lookup resolves the harness against the Vite root, so a project that
  // moves its root would never find one written beside package.json.
  it("writes under the Vite root the project declares", async () => {
    const cwd = writeProject({
      "package.json": MINIMAL,
      "vite.config.ts": `export default { root: "app" };`,
    });

    await runInit({ cwd, force: false });

    expect(harnessIn(path.join(cwd, "app"))).toContain("defineHarness");
    expect(existsSync(path.join(cwd, HARNESS_FILE))).toBe(false);
    expect(written.join("")).toContain(path.join("app", HARNESS_FILE));
  });

  it("prefills from every dependency field", async () => {
    const cwd = writeProject({
      "package.json": JSON.stringify({
        dependencies: { "@yagejs/renderer": "^0.10.0" },
        devDependencies: { "@yagejs/debug": "^0.10.0" },
        peerDependencies: {
          "@yagejs/core": "^0.10.0",
          "@yagejs/physics": "^0.10.0",
        },
      }),
    });

    await runInit({ cwd, force: false });
    const source = harnessIn(cwd);

    expect(source).toContain("new RendererPlugin({");
    expect(source).toContain("new DebugPlugin(");
    expect(source).toContain("new PhysicsPlugin(");
  });

  it("refuses to overwrite an existing harness", async () => {
    const cwd = writeProject({
      "package.json": MINIMAL,
      "lab/harness.ts": "// mine",
    });

    await expect(runInit({ cwd, force: false })).rejects.toThrow(/--force/);
    expect(harnessIn(cwd)).toBe("// mine");
  });

  // The lookup probes four extensions, so writing the .ts would shadow a
  // hand-written harness under any of the other three.
  it("refuses when a harness exists under another extension", async () => {
    const cwd = writeProject({
      "package.json": MINIMAL,
      "lab/harness.mjs": "// mine",
    });

    await expect(runInit({ cwd, force: false })).rejects.toThrow(
      /harness\.mjs already exists/,
    );
    expect(existsSync(path.join(cwd, HARNESS_FILE))).toBe(false);
  });

  it("overwrites with --force", async () => {
    const cwd = writeProject({
      "package.json": MINIMAL,
      "lab/harness.ts": "// mine",
    });

    await runInit({ cwd, force: true });

    expect(harnessIn(cwd)).toContain("defineHarness");
  });

  it("refuses a project missing a package the harness imports", async () => {
    const noRenderer = writeProject({
      "package.json": manifest({ "@yagejs/core": "^0.10.0" }),
    });
    const noCore = writeProject({
      "package.json": manifest({ "@yagejs/renderer": "^0.10.0" }),
    });

    await expect(runInit({ cwd: noRenderer, force: false })).rejects.toThrow(
      /@yagejs\/renderer/,
    );
    await expect(runInit({ cwd: noCore, force: false })).rejects.toThrow(
      /@yagejs\/core/,
    );
  });

  it("refuses a directory that is not a project", async () => {
    const cwd = writeProject({ "src/main.ts": "" });

    await expect(runInit({ cwd, force: false })).rejects.toThrow(
      /No package.json/,
    );
  });

  it("reports the plugins it wrote", async () => {
    const cwd = writeProject({
      "package.json": manifest({
        "@yagejs/core": "^0.10.0",
        "@yagejs/renderer": "^0.10.0",
        "@yagejs/audio": "^0.10.0",
      }),
    });

    await runInit({ cwd, force: false });

    expect(written.join("")).toContain("RendererPlugin, AudioPlugin");
  });

  it("names the package that would bring a skipped plugin in", async () => {
    const cwd = writeProject({
      "package.json": manifest({
        "@yagejs/core": "^0.10.0",
        "@yagejs/renderer": "^0.10.0",
        "@yagejs/ui-react": "^0.10.0",
      }),
    });

    await runInit({ cwd, force: false });

    expect(written.join("")).toMatch(
      /UIReactPlugin — install @yagejs\/ui\b/,
    );
  });

  it("says the lab supplies DebugPlugin when the project has no @yagejs/debug", async () => {
    const cwd = writeProject({ "package.json": MINIMAL });

    await runInit({ cwd, force: false });

    expect(written.join("")).toMatch(/@yagejs\/debug is not a dependency/);
    expect(written.join("")).toMatch(/the lab adds a default one/);
  });
});

import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removeProjects, writeProject } from "../test-helpers.js";
import { createLabConfig } from "./labConfig.js";

/** Vite's plugin arrays nest, and hold falsy entries for disabled plugins. */
function pluginNames(plugins: unknown): string[] {
  const names: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value && typeof value === "object" && "name" in value) {
      names.push(String((value as { name: unknown }).name));
    }
  };
  visit(plugins);
  return names;
}

const serve = { command: "serve", mode: "development" } as const;

afterEach(removeProjects);

describe("createLabConfig", () => {
  it("works without a project config, which is a legitimate setup", async () => {
    const cwd = writeProject({ "package.json": "{}" });

    const lab = await createLabConfig({ cwd, env: serve });

    expect(lab.configFile).toBeUndefined();
    expect(lab.root).toBe(cwd);
    expect(pluginNames(lab.config.plugins)).toEqual(["yage-lab"]);
  });

  it("keeps the project's own plugins and transforms", async () => {
    const cwd = writeProject({
      "package.json": "{}",
      "vite.config.ts": `export default {
        plugins: [{ name: "game-plugin" }],
        oxc: { decorator: { legacy: true } },
      };`,
    });

    const lab = await createLabConfig({ cwd, env: serve });

    expect(pluginNames(lab.config.plugins)).toEqual([
      "game-plugin",
      "yage-lab",
    ]);
    expect(lab.config.oxc).toEqual({ decorator: { legacy: true } });
  });

  it("does not re-read the config it just merged", async () => {
    const cwd = writeProject({
      "package.json": "{}",
      "vite.config.ts": `export default { plugins: [{ name: "game-plugin" }] };`,
    });

    const lab = await createLabConfig({ cwd, env: serve });

    expect(lab.config.configFile).toBe(false);
  });

  it("takes the root the project declares instead of relocating it", async () => {
    const cwd = writeProject({
      "package.json": "{}",
      "vite.config.ts": `export default { root: "app" };`,
    });

    const lab = await createLabConfig({ cwd, env: serve });

    expect(lab.root).toBe(path.join(cwd, "app"));
    expect(lab.config.root).toBe(path.join(cwd, "app"));
  });

  it("fails on a config that exists but cannot be loaded", async () => {
    const cwd = writeProject({
      "package.json": "{}",
      "vite.config.ts": `throw new Error("boom");`,
    });

    // Falling back to defaults here would drop the project's wasm and decorator
    // setup, and the loss would only show up as a runtime error later.
    await expect(createLabConfig({ cwd, env: serve })).rejects.toThrow(/boom/);
  });

  it("reads scenario patterns from package.json", async () => {
    const cwd = writeProject({
      "package.json": JSON.stringify({
        "yage-lab": { scenarios: ["src/lab/**/*.scenario.ts"] },
      }),
    });

    const lab = await createLabConfig({ cwd, env: serve });

    expect(lab.scenarios).toEqual(["src/lab/**/*.scenario.ts"]);
  });

  it("lets the caller's patterns win over package.json", async () => {
    const cwd = writeProject({
      "package.json": JSON.stringify({
        "yage-lab": { scenarios: ["src/lab/**/*.scenario.ts"] },
      }),
    });

    const lab = await createLabConfig({
      cwd,
      env: serve,
      scenarios: ["ui/**/*.scenario.ts"],
    });

    expect(lab.scenarios).toEqual(["ui/**/*.scenario.ts"]);
  });

  it("falls back to every *.scenario.ts", async () => {
    const cwd = writeProject({ "package.json": "{}" });

    const lab = await createLabConfig({ cwd, env: serve });

    expect(lab.scenarios).toEqual(["**/*.scenario.ts"]);
  });

  it("rejects a malformed scenarios entry rather than browsing other files", async () => {
    const cwd = writeProject({
      "package.json": JSON.stringify({ "yage-lab": { scenarios: "src" } }),
    });

    await expect(createLabConfig({ cwd, env: serve })).rejects.toThrow(
      /non-empty array/,
    );
  });
});

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveConfig } from "vite";
import {
  removeProjects,
  STUB_HARNESS,
  writeProject,
} from "../test-helpers.js";
import { labBuildConfig, runBuild } from "./build.js";
import { createLabConfig } from "./labConfig.js";

/**
 * What Vite ends up building, rather than what the config object looks like.
 * The two differ: `build.rollupOptions` is an accessor onto another option, so
 * a config that reads correctly can still resolve to something else.
 */
async function resolvedInput(
  cwd: string,
): Promise<{ input: unknown; keepNames: unknown }> {
  const lab = await createLabConfig({
    cwd,
    env: { command: "build", mode: "production" },
  });
  const page = path.join(lab.root, ".yage-lab.html");
  const resolved = await resolveConfig(
    labBuildConfig(lab, { outDir: "dist-lab", page }),
    "build",
    "production",
    "production",
  );
  const output = resolved.build.rollupOptions.output;
  return {
    input: resolved.build.rollupOptions.input,
    keepNames: Array.isArray(output) ? output[0]?.keepNames : output?.keepNames,
  };
}

afterEach(removeProjects);

describe("labBuildConfig", () => {
  it("builds the lab page alone when the project builds one page", async () => {
    const cwd = writeProject({
      "package.json": "{}",
      "lab/harness.ts": STUB_HARNESS,
      "vite.config.ts": `export default {
        build: { rollupOptions: { input: "index.html" } },
      };`,
    });

    const { input } = await resolvedInput(cwd);

    expect(input).toEqual({ index: path.join(cwd, ".yage-lab.html") });
  });

  it("builds it alone when the project builds many", async () => {
    const cwd = writeProject({
      "package.json": "{}",
      "lab/harness.ts": STUB_HARNESS,
      "vite.config.ts": `export default {
        build: { rollupOptions: { input: { main: "index.html", about: "about.html" } } },
      };`,
    });

    const { input } = await resolvedInput(cwd);

    expect(input).toEqual({ index: path.join(cwd, ".yage-lab.html") });
  });

  it("builds it alone when the project lists its pages as an array", async () => {
    const cwd = writeProject({
      "package.json": "{}",
      "lab/harness.ts": STUB_HARNESS,
      "vite.config.ts": `export default {
        build: { rollupOptions: { input: ["index.html", "about.html"] } },
      };`,
    });

    const { input } = await resolvedInput(cwd);

    expect(input).toEqual({ index: path.join(cwd, ".yage-lab.html") });
  });

  it("keeps the project's other build options", async () => {
    // @yagejs/save restores classes by name, so a mangled class name in the
    // built lab would break exactly the scenarios that exercise save/load.
    const cwd = writeProject({
      "package.json": "{}",
      "lab/harness.ts": STUB_HARNESS,
      "vite.config.ts": `export default {
        build: { rollupOptions: { input: "index.html", output: { keepNames: true } } },
      };`,
    });

    const { input, keepNames } = await resolvedInput(cwd);

    expect(input).toEqual({ index: path.join(cwd, ".yage-lab.html") });
    expect(keepNames).toBe(true);
  });
});

describe("runBuild", () => {
  /**
   * A real build of a throwaway project. The runner is stubbed inside the
   * project, because a directory outside this repo cannot resolve
   * `@yagejs-tools/lab` by name.
   */
  function buildable(): string {
    return writeProject({
      "package.json": JSON.stringify({ type: "module" }),
      "lab/harness.ts": STUB_HARNESS,
      "src/drop.scenario.ts": `export default { title: "T", setup() {} };`,
      "stub-runner.ts": `export function mount() { return Promise.resolve({}); }`,
      "vite.config.ts": `import path from "node:path";
        export default {
          resolve: {
            alias: { "@yagejs-tools/lab/runner": path.join(__dirname, "stub-runner.ts") },
          },
        };`,
    });
  }

  it("writes a page that can be served from the output directory", async () => {
    const cwd = buildable();

    await runBuild({ cwd, outDir: "dist-lab" });

    const page = readFileSync(path.join(cwd, "dist-lab/index.html"), "utf8");
    expect(page).toContain("<script");
    expect(readdirSync(path.join(cwd, "dist-lab"))).toEqual(
      expect.arrayContaining(["index.html", "assets"]),
    );
  });

  it("adds no file of its own to the project", async () => {
    const cwd = buildable();
    const before = readdirSync(cwd).sort();

    await runBuild({ cwd, outDir: "dist-lab" });

    expect(readdirSync(cwd).sort()).toEqual([...before, "dist-lab"].sort());
    expect(existsSync(path.join(cwd, "dist-lab/.yage-lab.html"))).toBe(false);
  });

  it("refuses an output directory that holds the project", async () => {
    // Vite empties an output directory inside the root, so building into the
    // root itself would delete the project's own files.
    const cwd = buildable();

    await expect(runBuild({ cwd, outDir: "." })).rejects.toThrow(
      /holds the project itself/,
    );
    await expect(runBuild({ cwd, outDir: ".." })).rejects.toThrow(
      /holds the project itself/,
    );

    expect(existsSync(path.join(cwd, "package.json"))).toBe(true);
    expect(existsSync(path.join(cwd, "src/drop.scenario.ts"))).toBe(true);
  });

  it("adds none when the build fails either", async () => {
    const cwd = writeProject({
      "package.json": JSON.stringify({ type: "module" }),
      "lab/harness.ts": STUB_HARNESS,
      "vite.config.ts": `export default {
        plugins: [{ name: "boom", buildStart() { throw new Error("boom"); } }],
      };`,
    });
    const before = readdirSync(cwd).sort();

    await expect(runBuild({ cwd, outDir: "dist-lab" })).rejects.toThrow(/boom/);

    expect(readdirSync(cwd).sort()).toEqual(before);
  });
});

import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  createServer,
  mergeConfig,
  type InlineConfig,
  type ViteDevServer,
} from "vite";
import { createLabConfig } from "../cli/labConfig.js";
import { removeProjects, STUB_HARNESS, writeProject } from "../test-helpers.js";
import { LAB_ENTRY_ID } from "./labPlugin.js";

const RUNNER = fileURLToPath(new URL("../runner.ts", import.meta.url));

const servers: ViteDevServer[] = [];

interface ServerOptions {
  scenarios?: readonly string[] | undefined;
  /** Bind a port, for tests that go through HTTP. */
  listen?: boolean;
}

/**
 * A dev server on the config `yage-lab dev` would use.
 *
 * The runner is aliased because a throwaway project outside this repo cannot
 * resolve `@yagejs-tools/lab` by name. The module is only resolved here, never
 * loaded.
 */
async function labServer(
  cwd: string,
  opts: ServerOptions = {},
): Promise<ViteDevServer> {
  const lab = await createLabConfig({
    cwd,
    env: { command: "serve", mode: "development" },
    scenarios: opts.scenarios,
  });
  const server = await createServer(
    mergeConfig(lab.config, {
      appType: "custom",
      logLevel: "silent",
      resolve: { alias: { "@yagejs-tools/lab/runner": RUNNER } },
      server: {
        ...(opts.listen ? { port: 0 } : { middlewareMode: true }),
        preTransformRequests: false,
      },
    } satisfies InlineConfig),
  );
  servers.push(server);
  if (opts.listen) await server.listen();
  return server;
}

const SCENARIO = `export default { title: "T", setup() {} };`;

const GAME: Record<string, string> = {
  "package.json": "{}",
  "lab/harness.ts": STUB_HARNESS,
  "src/lab/drop.scenario.ts": SCENARIO,
  "src/lab/enemies/slime.scenario.ts": SCENARIO,
  "dist/stale.scenario.ts": SCENARIO,
};

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  removeProjects();
});

describe("the generated entry", () => {
  it("imports every scenario the glob finds", async () => {
    const server = await labServer(writeProject(GAME), {
      scenarios: ["src/lab/**/*.scenario.ts"],
    });

    const result = await server.transformRequest(LAB_ENTRY_ID);

    expect(result?.code).toContain("/src/lab/drop.scenario.ts");
    expect(result?.code).toContain("/src/lab/enemies/slime.scenario.ts");
  });

  it("skips build output", async () => {
    const server = await labServer(writeProject(GAME));

    const result = await server.transformRequest(LAB_ENTRY_ID);

    expect(result?.code).toContain("/src/lab/drop.scenario.ts");
    expect(result?.code).not.toContain("stale.scenario.ts");
  });

  it("imports the harness found by convention", async () => {
    const server = await labServer(writeProject(GAME));

    const result = await server.transformRequest(LAB_ENTRY_ID);

    expect(result?.code).toContain("/lab/harness.ts");
  });

  it("says what to create when the project has no harness", async () => {
    const cwd = writeProject({ "package.json": "{}" });

    await expect(labServer(cwd)).rejects.toThrow(/No lab harness found/);
  });
});

describe("the lab page", () => {
  it("is served in place of the project's own index.html", async () => {
    const cwd = writeProject({ ...GAME, "index.html": "<h1>the game</h1>" });
    const server = await labServer(cwd, { listen: true });
    const url = server.resolvedUrls?.local[0];

    const page = await fetch(url as string).then((res) => res.text());

    expect(page).toContain(`src="${LAB_ENTRY_ID}"`);
    expect(page).not.toContain("the game");
    // Injected by transformIndexHtml, which is why the page goes through it.
    expect(page).toContain("/@vite/client");
  });
});

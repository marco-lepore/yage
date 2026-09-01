import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import type { ResolvedEditorConfig } from "../config/index.js";
import { EDITOR_TOKEN_META, PLAY_HOST_ID } from "./editorHtml.js";
import { yageEditor } from "./editorPlugin.js";

const TOKEN = "test-token";
const EPOCH = "test-epoch";
const LEVEL = "src/levels/forest.yage-level.json";
const API = "/__yage_editor/api/v1";

const roots: string[] = [];
const servers: ViteDevServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

const LEVEL_TEXT = JSON.stringify({
  format: "yage-level",
  version: 1,
  id: "forest",
  entities: [
    {
      id: "crate-1",
      type: "Crate",
      typeVersion: 1,
      transform: {
        position: { x: 0, y: 0 },
        rotation: 0,
        scale: { x: 1, y: 1 },
      },
    },
  ],
});

const GAME_PAGE = `<!doctype html>
<html lang="en"><head><title>game</title></head><body></body></html>
`;

interface Fixture {
  root: string;
  base: string;
  api(
    route: string,
    init?: RequestInit & { token?: string | null },
  ): Promise<Response>;
}

interface EditorOptions {
  readonly gamePage?: string;
  /** The project's Vite base, which is where the editor page is served. */
  readonly base?: string;
  /**
   * Asset globs. Two files are written under `sprites/` and one under the
   * default `publicDir`, so a glob can pick either layout.
   */
  readonly assets?: readonly string[];
}

async function startEditor(options: EditorOptions = {}): Promise<Fixture> {
  const { gamePage } = options;
  const assets = options.assets ?? [];
  const root = await mkdtemp(path.join(tmpdir(), "yage-editor-http-"));
  roots.push(root);
  await mkdir(path.join(root, "src/levels"), { recursive: true });
  await mkdir(path.join(root, "play"), { recursive: true });
  await writeFile(path.join(root, LEVEL), LEVEL_TEXT);
  await writeFile(path.join(root, "game.html"), GAME_PAGE);
  await writeFile(path.join(root, "other.html"), GAME_PAGE);
  await writeFile(path.join(root, "play/index.html"), GAME_PAGE);
  if (assets.length > 0) {
    await mkdir(path.join(root, "sprites"), { recursive: true });
    await writeFile(path.join(root, "sprites/crate.png"), "crate");
    await writeFile(path.join(root, "sprites/barrel.png"), "barrel");
    await mkdir(path.join(root, "public/sprites"), { recursive: true });
    await writeFile(path.join(root, "public/sprites/hero.png"), "hero");
  }

  const config: ResolvedEditorConfig = {
    root,
    configFile: path.join(root, "editor/config.ts"),
    projectId: "fixture-project",
    modules: { project: "/src/levelProject.ts", harness: "/lab/harness.ts" },
    levels: ["src/levels/**/*.yage-level.json"],
    assets,
    ...(gamePage === undefined ? {} : { gamePage }),
  };

  const server = await createServer({
    root,
    configFile: false,
    // What the CLI builds: the project's own pages are served, and the
    // plugin's middleware is what answers `/` with the editor.
    appType: "mpa",
    logLevel: "silent",
    ...(options.base === undefined ? {} : { base: options.base }),
    plugins: [yageEditor({ config, token: TOKEN, epoch: EPOCH })],
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  servers.push(server);
  await server.listen();
  const base = server.resolvedUrls?.local[0];
  if (base === undefined) throw new Error("the editor server has no local URL");

  return {
    root,
    base,
    api(route, init) {
      const token = init && "token" in init ? init.token : TOKEN;
      const headers = new Headers(init?.headers);
      if (token !== null && token !== undefined) {
        headers.set("x-yage-editor-token", token);
      }
      if (init?.body !== undefined) {
        headers.set("Content-Type", "application/json");
      }
      return fetch(new URL(`${API}${route}`.slice(1), base), {
        ...init,
        headers,
      });
    },
  };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("the editor page", () => {
  it("serves a page carrying this process's token", async () => {
    const editor = await startEditor();

    const response = await fetch(editor.base);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain(EDITOR_TOKEN_META);
    expect(html).toContain(TOKEN);
    expect(html).toContain(
      '<script type="module" src="/@yage-editor/entry.js">',
    );
  });
});

describe("the token on project pages", () => {
  it("puts it on no project page, the game page included", async () => {
    // A game reads its level file and never speaks to the editor server, so
    // it has nothing to authenticate. Nothing the project serves carries the
    // token; only the editor's own pages do.
    const editor = await startEditor({ gamePage: "/game.html" });

    for (const page of ["game.html", "game.html?level=a", "other.html"]) {
      const html = await (await fetch(new URL(page, editor.base))).text();
      expect(html).not.toContain(TOKEN);
    }
  });

  it("puts it on the editor's own pages", async () => {
    const editor = await startEditor();

    const shell = await (await fetch(editor.base)).text();
    const play = await (await fetch(new URL("play.html", editor.base))).text();

    expect(shell).toContain(EDITOR_TOKEN_META);
    expect(shell).toContain(TOKEN);
    expect(play).toContain(TOKEN);
  });

  it("keeps the token on the editor page when the request carries a query", async () => {
    const editor = await startEditor();

    const html = await (await fetch(new URL("?debug=1", editor.base))).text();

    // Without it the page loads with an empty token and every request 401s.
    expect(html).toContain(TOKEN);
  });
});

describe("a project with a Vite base", () => {
  it("still serves the editor page with its token", async () => {
    const editor = await startEditor({ base: "/app/", gamePage: "/game.html" });

    // `resolvedUrls` already carries the base, so this is `/app/`.
    const response = await fetch(editor.base);
    const html = await response.text();

    // Without the token the generated entry mounts with an empty one and every
    // request comes back 401, so the editor never starts.
    expect(response.status).toBe(200);
    expect(html).toContain(TOKEN);
    // Vite prefixes the base onto the entry's src; it strips the base again
    // from the request, so the id the plugin resolves is unchanged.
    expect(html).toContain('src="/app/@yage-editor/entry.js"');
  });

  it("reaches the editor from the server root, at the base", async () => {
    const editor = await startEditor({ base: "/app/", gamePage: "/game.html" });

    const response = await fetch(new URL("/", editor.base));

    // Through Vite's own redirect, so the page that loads is the one at the
    // base. That is what the editor's relative run URL resolves against.
    expect(response.status).toBe(200);
    expect(new URL(response.url).pathname).toBe("/app/");
    expect(await response.text()).toContain(TOKEN);
  });

  it("keeps the token off the game page", async () => {
    const editor = await startEditor({ base: "/app/", gamePage: "/game.html" });

    const html = await (await fetch(new URL("game.html", editor.base))).text();

    // A game reads its level file and never speaks to the editor, so it has
    // nothing to authenticate and is given nothing to authenticate with.
    expect(html).not.toContain(TOKEN);
  });

  it("serves the play page, with the token it needs to read the draft", async () => {
    const editor = await startEditor({ base: "/app/" });

    const response = await fetch(new URL("play.html", editor.base));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain(TOKEN);
    expect(html).toContain(PLAY_HOST_ID);
  });
});

describe("the API boundary", () => {
  it("refuses a request with no token", async () => {
    const editor = await startEditor();

    const response = await editor.api("/bootstrap", { token: null });

    expect(response.status).toBe(401);
  });

  it("refuses a request with another process's token", async () => {
    const editor = await startEditor();

    const response = await editor.api("/bootstrap", { token: "stale-token" });

    expect(response.status).toBe(401);
  });

  it("refuses a cross-origin request that carries the token", async () => {
    const editor = await startEditor();

    const response = await editor.api("/bootstrap", {
      headers: { Origin: "http://evil.example" },
    });

    expect(response.status).toBe(403);
  });

  it("answers an unknown route with 404 rather than the page", async () => {
    const editor = await startEditor();

    const response = await editor.api("/draft/rename", { method: "POST" });

    expect(response.status).toBe(404);
  });

  it("refuses an asset listing with no token", async () => {
    const editor = await startEditor({ assets: ["sprites/*.png"] });

    const response = await editor.api("/assets", { token: null });

    expect(response.status).toBe(401);
  });

  it("refuses an undo body carrying anything but a revision", async () => {
    const editor = await startEditor();

    const response = await editor.api(`/draft/undo?path=${LEVEL}`, {
      method: "POST",
      body: JSON.stringify({
        epoch: EPOCH,
        expectedDraftRevision: 0,
        document: {},
      }),
    });

    expect(response.status).toBe(400);
  });

  it("refuses a body that is not a request this version understands", async () => {
    const editor = await startEditor();

    const response = await editor.api(`/draft/command?path=${LEVEL}`, {
      method: "POST",
      body: JSON.stringify({
        epoch: EPOCH,
        expectedDraftRevision: 0,
        command: { kind: "set-name", commandId: "a", name: "crate" },
      }),
    });

    expect(response.status).toBe(400);
  });

  it("refuses a body too large to be an editor request", async () => {
    const editor = await startEditor();

    const response = await editor.api(`/draft/command?path=${LEVEL}`, {
      method: "POST",
      body: JSON.stringify({ filler: "x".repeat(2 * 1024 * 1024) }),
    });

    expect(response.status).toBe(413);
  });
});

describe("the draft routes", () => {
  it("bootstraps with the project, the epoch, and the level list", async () => {
    const editor = await startEditor();

    const body = await json(await editor.api("/bootstrap"));

    expect(body["projectId"]).toBe("fixture-project");
    expect(body["epoch"]).toBe(EPOCH);
    expect(body["levels"]).toEqual([
      { path: LEVEL, diskRevision: expect.any(String) as unknown as string },
    ]);
  });

  it("lists the project files the asset globs match", async () => {
    const editor = await startEditor({ assets: ["sprites/*.png"] });

    const body = await json(await editor.api("/assets"));

    expect(body).toEqual({
      paths: ["sprites/barrel.png", "sprites/crate.png"],
      truncated: false,
    });
  });

  it("lists a publicDir asset by the path the game loads", async () => {
    const editor = await startEditor({ assets: ["public/sprites/*.png"] });

    const body = await json(await editor.api("/assets"));

    // The glob names where the file sits; Vite serves the directory's contents
    // at the server root, so the path a level stores has no `public/` in it.
    expect(body).toEqual({ paths: ["sprites/hero.png"], truncated: false });
    expect((await fetch(new URL("sprites/hero.png", editor.base))).status).toBe(
      200,
    );
  });

  it("answers an empty listing for a project that configured no assets", async () => {
    const editor = await startEditor();

    const body = await json(await editor.api("/assets"));

    expect(body).toEqual({ paths: [], truncated: false });
  });

  it("opens, edits, and saves one level end to end", async () => {
    const editor = await startEditor();
    const opened = await json(await editor.api(`/draft?path=${LEVEL}`));
    const snapshot = opened["snapshot"] as Record<string, unknown>;

    const commanded = await json(
      await editor.api(`/draft/command?path=${LEVEL}`, {
        method: "POST",
        body: JSON.stringify({
          epoch: EPOCH,
          expectedDraftRevision: snapshot["draftRevision"],
          command: {
            kind: "set-poses",
            commandId: "drag-1",
            poses: [
              {
                id: "crate-1",
                transform: {
                  position: { x: 64, y: 32 },
                  rotation: 0,
                  scale: { x: 1, y: 1 },
                },
              },
            ],
          },
        }),
      }),
    );
    const edited = commanded["snapshot"] as Record<string, unknown>;
    const saved = await json(
      await editor.api(`/draft/save?path=${LEVEL}`, {
        method: "POST",
        body: JSON.stringify({
          epoch: EPOCH,
          expectedDraftRevision: edited["draftRevision"],
          expectedDiskRevision: snapshot["diskRevision"],
        }),
      }),
    );

    expect(commanded["status"]).toBe("accepted");
    expect(edited["dirty"]).toBe(true);
    expect(saved["status"]).toBe("accepted");
    expect((saved["snapshot"] as Record<string, unknown>)["dirty"]).toBe(false);
    const onDisk = await readFile(path.join(editor.root, LEVEL), "utf8");
    expect(onDisk).toContain('"x": 64');
  });

  it("undoes and redoes an accepted edit over HTTP", async () => {
    const editor = await startEditor();
    await editor.api(`/draft?path=${LEVEL}`);
    await editor.api(`/draft/command?path=${LEVEL}`, {
      method: "POST",
      body: JSON.stringify({
        epoch: EPOCH,
        expectedDraftRevision: 0,
        command: {
          kind: "set-poses",
          commandId: "drag-1",
          poses: [
            {
              id: "crate-1",
              transform: {
                position: { x: 64, y: 32 },
                rotation: 0,
                scale: { x: 1, y: 1 },
              },
            },
          ],
        },
      }),
    });

    const undone = await json(
      await editor.api(`/draft/undo?path=${LEVEL}`, {
        method: "POST",
        body: JSON.stringify({ epoch: EPOCH, expectedDraftRevision: 1 }),
      }),
    );
    const redone = await json(
      await editor.api(`/draft/redo?path=${LEVEL}`, {
        method: "POST",
        body: JSON.stringify({ epoch: EPOCH, expectedDraftRevision: 2 }),
      }),
    );

    const before = undone["snapshot"] as Record<string, unknown>;
    const after = redone["snapshot"] as Record<string, unknown>;
    expect(before["history"]).toEqual({ undoDepth: 0, redoDepth: 1 });
    expect(after["history"]).toEqual({ undoDepth: 1, redoDepth: 0 });
    expect(JSON.stringify(before["document"])).not.toContain('"x":64');
    expect(JSON.stringify(after["document"])).toContain('"x":64');
  });

  it("has no run route: a game reads its level file like any other", async () => {
    const editor = await startEditor();

    const response = await editor.api(
      `/draft/run?path=${LEVEL}&epoch=${EPOCH}&draftRevision=0`,
    );

    expect(response.status).toBe(404);
  });

  it("answers a stale command with the current draft", async () => {
    const editor = await startEditor();
    await editor.api(`/draft?path=${LEVEL}`);
    const command = {
      kind: "set-poses",
      commandId: "drag-1",
      poses: [
        {
          id: "crate-1",
          transform: {
            position: { x: 1, y: 1 },
            rotation: 0,
            scale: { x: 1, y: 1 },
          },
        },
      ],
    };
    const body = JSON.stringify({
      epoch: EPOCH,
      expectedDraftRevision: 0,
      command,
    });

    const [first, second] = await Promise.all([
      editor.api(`/draft/command?path=${LEVEL}`, { method: "POST", body }),
      editor.api(`/draft/command?path=${LEVEL}`, { method: "POST", body }),
    ]);
    const outcomes = [
      (await json(first))["status"],
      (await json(second))["status"],
    ];

    expect(outcomes.filter((status) => status === "accepted")).toHaveLength(1);
    expect(outcomes.filter((status) => status === "stale")).toHaveLength(1);
  });
});

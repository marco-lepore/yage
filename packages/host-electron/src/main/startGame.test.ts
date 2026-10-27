import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "../protocol.js";
import type { FakeBrowserWindow } from "../test/fakeElectron.js";
import type { GameShellOptions } from "./startGame.js";

/**
 * The module under test and the stand-in it reads, both fresh: `startGame`
 * serves one game per process, so each case needs its own process.
 */
async function load(): Promise<
  typeof import("./startGame.js") & {
    fake: typeof import("../test/fakeElectron.js");
  }
> {
  vi.resetModules();
  const fake = await import("../test/fakeElectron.js");
  return { ...(await import("./startGame.js")), fake };
}

let webDir: string;

beforeEach(async () => {
  webDir = await mkdtemp(join(tmpdir(), "yage-shell-"));
  await writeFile(join(webDir, "index.html"), "<!doctype html>", "utf8");
});

afterEach(async () => {
  await rm(webDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

function options(overrides: Record<string, unknown> = {}): GameShellOptions {
  return {
    webDir,
    appId: "dev.yage.baseline",
    profile: "test",
    ...overrides,
  } as GameShellOptions;
}

describe("startGame", () => {
  it("registers the game scheme at the call, before it returns", async () => {
    const { startGame, fake } = await load();
    const started = startGame(options());
    expect(fake.protocol.privileged).toEqual([
      {
        scheme: "yage",
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          corsEnabled: true,
          stream: true,
          codeCache: true,
        },
      },
    ]);
    await started;
    expect(fake.protocol.handlers.has("yage")).toBe(true);
  });

  it("is called once, at the top of the main script", async () => {
    const { startGame, fake } = await load();
    fake.app.ready = true;
    await expect(startGame(options())).rejects.toThrowError(
      "startGame: call startGame at the top of the main script, before the app is ready.",
    );
    fake.app.ready = false;
    await startGame(options());
    await expect(startGame(options())).rejects.toThrowError(
      "startGame: the game is already started. Call startGame once per app.",
    );
  });

  it("names every option it cannot use, and opens nothing", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [
        { webDir: "web" },
        'startGame: webDir must be an absolute path, got "web".',
      ],
      [
        { webDir: tmpdir() },
        `startGame: webDir must hold an index.html, got ${JSON.stringify(tmpdir())}.`,
      ],
      [
        { appId: "-x" },
        'startGame: appId must match ^[A-Za-z0-9][A-Za-z0-9.-]*$, got "-x".',
      ],
      [
        { profile: "Release" },
        'startGame: profile must match ^[a-z][a-z0-9-]*$, got "Release".',
      ],
      [
        { externalLinks: ["ftp://x"] },
        'startGame: externalLinks[0] must be an http, https or mailto URL, got "ftp://x".',
      ],
      [
        { externalLinks: ["nope"] },
        'startGame: externalLinks[0] must be an http, https or mailto URL, got "nope".',
      ],
      [
        {
          externalLinks: [
            "https://example.dev/",
            "https://player:secret@example.dev/",
          ],
        },
        'startGame: externalLinks[1] must not hold a user name or password, got "https://player:secret@example.dev/".',
      ],
      [
        { externalLinks: ["https://example.dev/?from=game"] },
        'startGame: externalLinks[0] must not hold a query or a hash, got "https://example.dev/?from=game".',
      ],
      [
        { externalLinks: ["https://example.dev/#top"] },
        'startGame: externalLinks[0] must not hold a query or a hash, got "https://example.dev/#top".',
      ],
      [
        { externalLinks: ["mailto:"] },
        'startGame: externalLinks[0] must name an address after "mailto:", got "mailto:".',
      ],
      [
        { externalLinks: ["mailto:support@example.dev?subject=Hi"] },
        'startGame: externalLinks[0] must not hold a query, got "mailto:support@example.dev?subject=Hi".',
      ],
      [
        { permissions: [""] },
        'startGame: permissions[0] must be a non-empty string, got "".',
      ],
      [
        { contentSecurityPolicy: "" },
        'startGame: contentSecurityPolicy must be a non-empty string, got "".',
      ],
      [
        { query: "x=1" },
        'startGame: query must be empty or start with "?", got "x=1".',
      ],
      [
        { window: { simpleFullscreen: true } },
        "startGame: window must not set simpleFullscreen, got true.",
      ],
    ];
    for (const [overrides, message] of cases) {
      const { startGame, fake } = await load();
      await expect(startGame(options(overrides)), message).rejects.toThrowError(
        message,
      );
      expect(fake.protocol.privileged).toEqual([]);
      expect(fake.FakeBrowserWindow.created).toEqual([]);
    }
  });

  it("opens one locked-down window and loads the game into it", async () => {
    const { startGame, fake } = await load();
    const win = (await startGame(
      options({ query: "?case=saves", window: { width: 800, title: "Game" } }),
    )) as unknown as FakeBrowserWindow;
    expect(fake.FakeBrowserWindow.created).toHaveLength(1);
    expect(win.options).toMatchObject({
      width: 800,
      title: "Game",
      show: false,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        devTools: false,
      },
    });
    expect(
      (win.options["webPreferences"] as { preload: string }).preload,
    ).toMatch(/preload\.cjs$/);
    expect(win.loaded).toBe("yage://game/index.html?case=saves");
    expect(win.shown).toBe(false);
    win.emit("ready-to-show");
    expect(win.shown).toBe(true);
  });

  it("refuses a remote-debugging switch in a packaged app, and opens nothing", async () => {
    for (const name of ["remote-debugging-port", "remote-debugging-pipe"]) {
      const { startGame, fake } = await load();
      fake.app.isPackaged = true;
      fake.app.switches.add(name);
      await expect(startGame(options()), name).rejects.toThrowError(
        `startGame: a packaged app does not load the game when started with --${name}, ` +
          "which lets another program control the page. Start the app without it, " +
          "or debug the game unpackaged.",
      );
      expect(fake.protocol.privileged).toEqual([]);
      expect(fake.FakeBrowserWindow.created).toEqual([]);
    }
  });

  it("opens a packaged app without the switch, and an unpackaged app with it", async () => {
    let loaded = await load();
    loaded.fake.app.isPackaged = true;
    await loaded.startGame(options());
    expect(loaded.fake.FakeBrowserWindow.created).toHaveLength(1);

    loaded = await load();
    loaded.fake.app.switches.add("remote-debugging-pipe");
    await loaded.startGame(options());
    expect(loaded.fake.FakeBrowserWindow.created).toHaveLength(1);
  });

  it("hands the focus to the running instance instead of opening a second", async () => {
    const { startGame, fake } = await load();
    fake.app.singleInstanceLock = false;
    await expect(startGame(options())).rejects.toThrowError(
      "startGame: another instance of this app is running. It received the focus.",
    );
    expect(fake.app.quitCalls).toBe(1);
    expect(fake.FakeBrowserWindow.created).toEqual([]);
  });

  it("brings its window back when a second launch hands it over", async () => {
    const { startGame, fake } = await load();
    const win = (await startGame(options())) as unknown as FakeBrowserWindow;
    win.minimized = true;
    win.focused = false;
    fake.app.emit("second-instance");
    expect(win.minimized).toBe(false);
    expect(win.focused).toBe(true);

    win.focused = false;
    fake.app.emit("second-instance");
    expect(win.focused).toBe(true);

    win.destroyed = true;
    win.focused = false;
    fake.app.emit("second-instance");
    expect(win.focused).toBe(false);
  });

  it("quits when the window closes", async () => {
    const { startGame, fake } = await load();
    await startGame(options());
    fake.app.emit("window-all-closed");
    expect(fake.app.quitCalls).toBe(1);
  });

  it("shows the player's menu in a release build", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    let loaded = await load();
    await loaded.startGame(options());
    expect(loaded.fake.Menu.built).toEqual([
      [{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }],
    ]);

    for (const platform of ["win32", "linux"]) {
      vi.stubGlobal("process", { ...process, platform });
      loaded = await load();
      await loaded.startGame(options());
      expect(loaded.fake.Menu.applicationMenu).toBeNull();
    }

    loaded = await load();
    await loaded.startGame(options({ devTools: true }));
    expect(loaded.fake.Menu.applicationMenu).toBe("electron-default");
  });

  it("keeps the page where it is and sends an allowed link to the system", async () => {
    const { startGame, fake } = await load();
    const win = (await startGame(
      options({ externalLinks: ["https://yage.dev/"] }),
    )) as unknown as FakeBrowserWindow;

    let prevented = false;
    win.webContents.emit("will-navigate", {
      preventDefault: () => {
        prevented = true;
      },
    });
    expect(prevented).toBe(true);

    expect(
      win.webContents.openHandler!({ url: "https://yage.dev/docs" }),
    ).toEqual({ action: "deny" });
    expect(
      win.webContents.openHandler!({ url: "https://example.com/" }),
    ).toEqual({ action: "deny" });
    expect(fake.shell.opened).toEqual(["https://yage.dev/docs"]);
  });

  it("opens a link only inside an allowed site path or at an allowed address", async () => {
    const { startGame, fake } = await load();
    const win = (await startGame(
      options({
        externalLinks: [
          "https://Example.dev",
          "https://yage.dev/docs/",
          "https://yage.dev/guides",
          "mailto:support@example.dev",
        ],
      }),
    )) as unknown as FakeBrowserWindow;
    const allowed = [
      "https://example.dev/",
      "https://example.dev/any/page?from=game#top",
      "https://example.dev:443/news",
      "https://yage.dev/docs",
      "https://yage.dev/docs/",
      "https://yage.dev/docs/guides/electron",
      "https://yage.dev/guides",
      "https://yage.dev/guides/electron",
      "mailto:support@example.dev",
    ];
    const refused = [
      "https://example.dev.other.test/",
      "https://example.devil.test/",
      "https://example.dev@evil.test/login",
      "https://example.dev:8443/",
      "http://example.dev/",
      "https://yage.dev/",
      "https://yage.dev/docs-private",
      "https://yage.dev/guides-private",
      "https://yage.dev/docs/../admin",
      "mailto:support@example.dev.other.test",
      "mailto:support@example.dev,someone@other.test",
      "mailto:support@example.dev?bcc=someone@other.test",
      "not a url",
    ];
    for (const url of [...allowed, ...refused]) {
      expect(win.webContents.openHandler!({ url }), url).toEqual({
        action: "deny",
      });
    }
    expect(fake.shell.opened).toEqual([
      "https://example.dev/",
      "https://example.dev/any/page?from=game#top",
      "https://example.dev/news",
      "https://yage.dev/docs",
      "https://yage.dev/docs/",
      "https://yage.dev/docs/guides/electron",
      "https://yage.dev/guides",
      "https://yage.dev/guides/electron",
      "mailto:support@example.dev",
    ]);
  });

  it("grants the game what a browser tab grants, and nothing else", async () => {
    const { startGame, fake } = await load();
    const win = (await startGame(
      options({ permissions: ["media"] }),
    )) as unknown as FakeBrowserWindow;
    const other = new fake.FakeBrowserWindow();
    const check = fake.session.defaultSession.checkHandler!;
    const ask = (contents: unknown, permission: string): boolean => {
      let answer = false;
      fake.session.defaultSession.requestHandler!(
        contents,
        permission,
        (granted) => {
          answer = granted;
        },
      );
      return answer;
    };

    for (const permission of [
      "fullscreen",
      "pointerLock",
      "keyboardLock",
      "clipboard-sanitized-write",
      "media",
    ]) {
      expect(check(win.webContents, permission), permission).toBe(true);
      expect(ask(win.webContents, permission), permission).toBe(true);
    }
    expect(check(win.webContents, "geolocation")).toBe(false);
    expect(ask(win.webContents, "geolocation")).toBe(false);
    expect(check(other.webContents, "fullscreen")).toBe(false);
    expect(ask(other.webContents, "fullscreen")).toBe(false);
  });

  it("sends the window's state to the page", async () => {
    const { startGame } = await load();
    const win = (await startGame(options())) as unknown as FakeBrowserWindow;
    win.focused = true;
    win.emit("focus");
    expect(win.webContents.sent.at(-1)).toMatchObject({
      channel: CHANNELS.state,
    });
  });

  it("answers the page's identity and save requests", async () => {
    const { startGame, fake } = await load();
    const win = (await startGame(options())) as unknown as FakeBrowserWindow;
    const event = {
      sender: win.webContents,
      senderFrame: win.webContents.mainFrame,
    };
    const start = (await fake.ipcMain.invoke(CHANNELS.start, event)) as {
      info: { appVersion: string };
      state: { revision: number };
    };
    expect(start.info.appVersion).toBe("1.2.3");
    expect(await fake.ipcMain.invoke(CHANNELS.savesList, event, "")).toEqual(
      [],
    );
  });

  it("serves the built directory under the default policy", async () => {
    const { startGame, DEFAULT_CONTENT_SECURITY_POLICY, fake } = await load();
    await startGame(options());
    const handler = fake.protocol.handlers.get("yage")!;
    const response = await handler(new Request("yage://game/"));
    expect(response.headers.get("Content-Security-Policy")).toBe(
      DEFAULT_CONTENT_SECURITY_POLICY,
    );
    expect(DEFAULT_CONTENT_SECURITY_POLICY).not.toContain("'unsafe-eval'");
  });

  it("serves a web directory given with a trailing separator", async () => {
    const { startGame, fake } = await load();
    await startGame(options({ webDir: webDir + sep }));
    const handler = fake.protocol.handlers.get("yage")!;
    const response = await handler(new Request("yage://game/"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(
      `file:${pathToFileURL(join(webDir, "index.html")).href}`,
    );
  });

  it("serves the policy the shell passed instead", async () => {
    const { startGame, fake } = await load();
    await startGame(options({ contentSecurityPolicy: "default-src 'none'" }));
    const handler = fake.protocol.handlers.get("yage")!;
    const response = await handler(new Request("yage://game/"));
    expect(response.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'",
    );
  });
});

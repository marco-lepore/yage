import { BrowserWindow, Menu, app, protocol, session, shell } from "electron";
import type { BrowserWindowConstructorOptions } from "electron";
import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileAdapter } from "@yagejs/save";
import { CHANNELS, GAME_ORIGIN } from "../protocol.js";
import { registerHostChannels, registerSaveChannels } from "./channels.js";
import { serveGameFile } from "./gameProtocol.js";
import { nodeFileStore } from "./nodeFileStore.js";
import { checkAppId, checkProfile, saveDirectory } from "./saveDirectory.js";
import { watchWindow } from "./windowState.js";

/**
 * The policy every response of the game protocol carries unless the shell
 * passes its own. It allows the engine what the engine uses and nothing
 * more: WebAssembly for physics and layout, a worker from a blob for image
 * decoding, a `data:` fetch for the layout library's own bundled
 * WebAssembly, and inline style, which the renderer writes on the canvas and
 * on the element that reports the scene to a screen reader. Turning strings
 * into code is not allowed.
 */
export const DEFAULT_CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; " +
  "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "font-src 'self' data:; " +
  "media-src 'self' data: blob:; connect-src 'self' data:; " +
  "worker-src 'self' blob:; object-src 'none'; base-uri 'none'; " +
  "form-action 'none'; frame-ancestors 'none'";

/**
 * What a browser tab grants without asking. Each one needs a user gesture or
 * fullscreen there and shows no prompt, so the shell matches it.
 */
const BROWSER_PARITY_PERMISSIONS: readonly string[] = [
  "fullscreen",
  "pointerLock",
  "keyboardLock",
  "clipboard-sanitized-write",
];

/** The window a game runs in, and what the shell around it allows. */
export interface GameShellOptions {
  /** Absolute path of the built web directory; may lie inside an archive. */
  readonly webDir: string;
  /** The app's stable identifier, the same in every release. Names the save directory. */
  readonly appId: string;
  /** The build profile, such as `"test"` or `"release"`. Test and release saves never mix. */
  readonly profile: string;
  /** Size, title and look of the game window. Web preferences stay the shell's. */
  readonly window?: Omit<
    BrowserWindowConstructorOptions,
    "webPreferences" | "show" | "simpleFullscreen"
  >;
  /**
   * Links `window.open` may open outside the app, in the system browser or
   * mail client. Default: none.
   *
   * An `http` or `https` entry allows its origin and every path at or below
   * its own, by whole segments: `"https://example.dev"` allows the whole site,
   * and `"https://example.dev/docs"` allows `/docs` and the paths under it but
   * not `/docs-private`. Such an entry holds no user name, password, query or
   * hash. A `mailto` entry allows that exact address, and only with no query.
   */
  readonly externalLinks?: readonly string[];
  /** Permissions granted beyond fullscreen, pointer lock, keyboard lock and clipboard writes. */
  readonly permissions?: readonly string[];
  /** Replaces {@link DEFAULT_CONTENT_SECURITY_POLICY}. */
  readonly contentSecurityPolicy?: string;
  /** Developer tools and Electron's default menu. Default: `false`. */
  readonly devTools?: boolean;
  /** Appended to the page's URL; empty or starting with `"?"`. */
  readonly query?: string;
}

/** One app serves one game, and the lock that keeps it to one process. */
let started = false;

/** The Chromium switches that let another program drive the page. */
const REMOTE_DEBUGGING_SWITCHES: readonly string[] = [
  "remote-debugging-port",
  "remote-debugging-pipe",
];

/** Parse one `externalLinks` entry, or throw naming it. */
function parseExternalLink(link: string, index: number): URL {
  const refuse = (constraint: string): Error =>
    new Error(
      `startGame: externalLinks[${index}] ${constraint}, got ${JSON.stringify(link)}.`,
    );
  const url = URL.parse(link);
  if (
    url === null ||
    (url.protocol !== "https:" &&
      url.protocol !== "http:" &&
      url.protocol !== "mailto:")
  ) {
    throw refuse("must be an http, https or mailto URL");
  }
  if (url.protocol === "mailto:") {
    if (url.pathname === "") {
      throw refuse('must name an address after "mailto:"');
    }
    if (url.search !== "") throw refuse("must not hold a query");
    return url;
  }
  if (url.username !== "" || url.password !== "") {
    throw refuse("must not hold a user name or password");
  }
  if (url.search !== "" || url.hash !== "") {
    throw refuse("must not hold a query or a hash");
  }
  return url;
}

/** Whether a link the page opens lies inside one of the shell's entries. */
function isAllowedLink(target: URL, links: readonly URL[]): boolean {
  return links.some((link) => {
    if (link.protocol === "mailto:") {
      return (
        target.protocol === "mailto:" &&
        target.search === "" &&
        target.pathname === link.pathname
      );
    }
    if (target.origin !== link.origin) return false;
    const base = link.pathname.replace(/\/+$/, "");
    return target.pathname === base || target.pathname.startsWith(`${base}/`);
  });
}

/**
 * Serve the game in one locked-down window. Call once, at the top of the main
 * script: the scheme the page is served from has to be registered before the
 * app is ready, and the call registers it before it returns.
 *
 * Every failure rejects the returned promise, an invalid option included.
 */
export async function startGame(
  options: GameShellOptions,
): Promise<BrowserWindow> {
  // The started check comes first: once a game is running the app is ready
  // too, and "already started" is the cause the caller can act on.
  if (started) {
    throw new Error(
      "startGame: the game is already started. Call startGame once per app.",
    );
  }
  if (app.isReady()) {
    throw new Error(
      "startGame: call startGame at the top of the main script, before the app is ready.",
    );
  }
  const webDir = options.webDir;
  if (typeof webDir !== "string" || !isAbsolute(webDir)) {
    throw new Error(
      `startGame: webDir must be an absolute path, got ${JSON.stringify(webDir)}.`,
    );
  }
  if (!existsSync(join(webDir, "index.html"))) {
    throw new Error(
      `startGame: webDir must hold an index.html, got ${JSON.stringify(webDir)}.`,
    );
  }
  // The file server compares resolved paths against this root, so a trailing
  // separator in the option would refuse every file.
  const root = resolve(webDir);
  checkAppId("startGame", options.appId);
  checkProfile("startGame", options.profile);
  const externalLinks = (options.externalLinks ?? []).map(parseExternalLink);
  const permissions = options.permissions ?? [];
  permissions.forEach((permission, index) => {
    if (typeof permission !== "string" || permission.length === 0) {
      throw new Error(
        `startGame: permissions[${index}] must be a non-empty string, got ` +
          `${JSON.stringify(permission)}.`,
      );
    }
  });
  const configured = options.contentSecurityPolicy;
  if (
    configured !== undefined &&
    (typeof configured !== "string" || configured.length === 0)
  ) {
    throw new Error(
      "startGame: contentSecurityPolicy must be a non-empty string, got " +
        `${JSON.stringify(configured)}.`,
    );
  }
  const policy = configured ?? DEFAULT_CONTENT_SECURITY_POLICY;
  const query = options.query ?? "";
  if (query !== "" && !query.startsWith("?")) {
    throw new Error(
      `startGame: query must be empty or start with "?", got ${JSON.stringify(query)}.`,
    );
  }
  // The type leaves the key out, but a JavaScript shell can still pass it, and
  // a simple-fullscreen window sends no fullscreen events.
  const window = options.window as { simpleFullscreen?: unknown } | undefined;
  if (window !== undefined && "simpleFullscreen" in window) {
    throw new Error(
      "startGame: window must not set simpleFullscreen, got " +
        `${JSON.stringify(window.simpleFullscreen)}.`,
    );
  }
  // No fuse turns these switches off, and Chromium reads them before the
  // main script runs, so the most a packaged app can do is not load the game.
  const debugging = app.isPackaged
    ? REMOTE_DEBUGGING_SWITCHES.find((name) => app.commandLine.hasSwitch(name))
    : undefined;
  if (debugging !== undefined) {
    throw new Error(
      `startGame: a packaged app does not load the game when started with ` +
        `--${debugging}, which lets another program control the page. ` +
        "Start the app without it, or debug the game unpackaged.",
    );
  }

  // Everything up to the first await runs at the call: Electron accepts the
  // scheme registration only before the app is ready.
  started = true;
  protocol.registerSchemesAsPrivileged([
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

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    throw new Error(
      "startGame: another instance of this app is running. It received the focus.",
    );
  }

  return open(options, root, policy, externalLinks, permissions, query);
}

async function open(
  options: GameShellOptions,
  root: string,
  policy: string,
  externalLinks: readonly URL[],
  permissions: readonly string[],
  query: string,
): Promise<BrowserWindow> {
  const devTools = options.devTools ?? false;
  await app.whenReady();

  protocol.handle("yage", (request) => serveGameFile(root, policy, request));

  const window = new BrowserWindow({
    ...options.window,
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools,
      preload: join(__dirname, "preload.cjs"),
    },
  });
  window.once("ready-to-show", () => window.show());

  const granted = new Set([...BROWSER_PARITY_PERMISSIONS, ...permissions]);
  const allows = (contents: unknown, permission: string): boolean =>
    contents === window.webContents && granted.has(permission);
  session.defaultSession.setPermissionRequestHandler(
    (contents, permission, callback) => {
      callback(allows(contents, permission));
    },
  );
  session.defaultSession.setPermissionCheckHandler((contents, permission) =>
    allows(contents, permission),
  );

  window.webContents.setWindowOpenHandler(({ url }) => {
    const target = URL.parse(url);
    // The system browser receives the URL as parsed here, so it opens the
    // target that was checked.
    if (target !== null && isAllowedLink(target, externalLinks)) {
      void shell.openExternal(target.href);
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());

  app.on("window-all-closed", () => app.quit());
  app.on("second-instance", () => {
    if (window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  setMenu(devTools);
  const watch = watchWindow(window, (state) => {
    window.webContents.send(CHANNELS.state, state);
  });

  // The page can reach a channel only once it loads, below.
  registerHostChannels({ window: () => window, watch: () => watch });
  registerSaveChannels(
    fileAdapter({
      store: nodeFileStore(
        saveDirectory({ appId: options.appId, profile: options.profile }),
      ),
    }),
    () => window,
  );

  await window.loadURL(`${GAME_ORIGIN}/index.html${query}`);
  return window;
}

/**
 * The player's menu: quit, the text-field commands and the window commands.
 * Electron's own menu offers Reload and Toggle Developer Tools, which a
 * release build does not show.
 */
function setMenu(devTools: boolean): void {
  if (devTools) return;
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: "appMenu" },
        { role: "editMenu" },
        { role: "windowMenu" },
      ]),
    );
    return;
  }
  Menu.setApplicationMenu(null);
}

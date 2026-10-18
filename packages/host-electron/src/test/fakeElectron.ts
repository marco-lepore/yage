/**
 * What the unit tests read in place of `electron`. The real package
 * downloads a browser binary the first time it is loaded, which a unit test
 * has no use for, so every test runs against this.
 */
import { EventEmitter } from "node:events";

/** A frame of a page, as the sender check reads it. */
export class FakeFrame {
  constructor(
    public url: string,
    public origin: string,
  ) {}
}

/** The page of a window, as the shell talks to it. */
export class FakeWebContents extends EventEmitter {
  readonly mainFrame = new FakeFrame("yage://game/index.html", "yage://game");
  readonly sent: { channel: string; payload: unknown }[] = [];
  openHandler:
    | ((details: { url: string }) => { action: "deny" | "allow" })
    | undefined;

  send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload });
  }

  setWindowOpenHandler(
    handler: (details: { url: string }) => { action: "deny" | "allow" },
  ): void {
    this.openHandler = handler;
  }

  openDevTools(): void {
    /* A window with developer tools turned off opens none. */
  }
}

/** The window the game runs in. */
export class FakeBrowserWindow extends EventEmitter {
  static readonly created: FakeBrowserWindow[] = [];

  readonly webContents = new FakeWebContents();
  readonly options: Record<string, unknown>;
  focused = false;
  visible = true;
  minimized = false;
  fullScreen = false;
  fullScreenable = true;
  destroyed = false;
  shown = false;
  loaded: string | null = null;
  /** Whether `setFullScreen` moves the window, so a refusal can be tested. */
  fullScreenCompletes = true;
  readonly fullScreenCalls: boolean[] = [];

  constructor(options: Record<string, unknown> = {}) {
    super();
    this.options = options;
    FakeBrowserWindow.created.push(this);
  }

  isFocused(): boolean {
    return this.focused;
  }
  isVisible(): boolean {
    return this.visible;
  }
  isMinimized(): boolean {
    return this.minimized;
  }
  isFullScreen(): boolean {
    return this.fullScreen;
  }
  isFullScreenable(): boolean {
    return this.fullScreenable;
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
  show(): void {
    this.shown = true;
  }
  focus(): void {
    this.focused = true;
  }
  restore(): void {
    this.minimized = false;
  }
  setFullScreen(active: boolean): void {
    this.fullScreenCalls.push(active);
    if (!this.fullScreenCompletes) return;
    this.fullScreen = active;
    this.emit(active ? "enter-full-screen" : "leave-full-screen");
  }
  loadURL(url: string): Promise<void> {
    this.loaded = url;
    return Promise.resolve();
  }
}

/** The application, with the few readings and calls the shell makes. */
class FakeApp extends EventEmitter {
  ready = false;
  version = "1.2.3";
  name = "Fake";
  singleInstanceLock = true;
  quitCalls = 0;
  paths: Record<string, string> = { appData: "/fake/appData" };

  isReady(): boolean {
    return this.ready;
  }
  whenReady(): Promise<void> {
    this.ready = true;
    return Promise.resolve();
  }
  getVersion(): string {
    return this.version;
  }
  getName(): string {
    return this.name;
  }
  getPath(name: string): string {
    return this.paths[name] ?? `/fake/${name}`;
  }
  requestSingleInstanceLock(): boolean {
    return this.singleInstanceLock;
  }
  quit(): void {
    this.quitCalls += 1;
  }
}

/** The main process's side of the bridge: handlers a test can call. */
class FakeIpcMain {
  readonly handlers = new Map<
    string,
    (event: unknown, ...args: unknown[]) => unknown
  >();

  handle(
    channel: string,
    handler: (event: never, ...args: never[]) => unknown,
  ): void {
    this.handlers.set(
      channel,
      handler as (event: unknown, ...args: unknown[]) => unknown,
    );
  }

  /**
   * Call one handler the way Electron would: the page always sees a promise,
   * so a handler that throws rejects rather than throwing at the caller.
   */
  async invoke(
    channel: string,
    event: unknown,
    ...args: unknown[]
  ): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (handler === undefined) {
      throw new Error(`fakeElectron: no handler for ${channel}.`);
    }
    return handler(event, ...args);
  }
}

/** The session, with the two permission answers the shell installs. */
class FakeSession {
  requestHandler:
    | ((
        contents: unknown,
        permission: string,
        callback: (granted: boolean) => void,
      ) => void)
    | undefined;
  checkHandler:
    | ((contents: unknown, permission: string) => boolean)
    | undefined;

  setPermissionRequestHandler(
    handler: (
      contents: unknown,
      permission: string,
      callback: (granted: boolean) => void,
    ) => void,
  ): void {
    this.requestHandler = handler;
  }

  setPermissionCheckHandler(
    handler: (contents: unknown, permission: string) => boolean,
  ): void {
    this.checkHandler = handler;
  }
}

class FakeProtocol {
  readonly privileged: unknown[] = [];
  handlers = new Map<string, (request: Request) => Promise<Response>>();

  registerSchemesAsPrivileged(schemes: unknown[]): void {
    this.privileged.push(...schemes);
  }

  handle(
    scheme: string,
    handler: (request: Request) => Promise<Response>,
  ): void {
    this.handlers.set(scheme, handler);
  }
}

/** The application menu, as the shell sets it. */
const FakeMenu = {
  applicationMenu: "electron-default" as unknown,
  built: [] as unknown[],
  setApplicationMenu(menu: unknown): void {
    FakeMenu.applicationMenu = menu;
  },
  buildFromTemplate(template: unknown[]): unknown {
    FakeMenu.built.push(template);
    return { template };
  },
};

export const app = new FakeApp();
export const BrowserWindow = FakeBrowserWindow;
export const ipcMain = new FakeIpcMain();
export const powerMonitor = new EventEmitter();
export const protocol = new FakeProtocol();
export const session = { defaultSession: new FakeSession() };
export const Menu = FakeMenu;

/** What `net.fetch` answered, and what a test wants it to answer next. */
export const net = {
  fetch: (url: string): Promise<Response> => net.respond(url),
  respond: (url: string): Promise<Response> =>
    Promise.resolve(new Response(`file:${url}`, { status: 200 })),
};

export const shell = {
  opened: [] as string[],
  openExternal: (url: string): Promise<void> => {
    shell.opened.push(url);
    return Promise.resolve();
  },
};

export const contextBridge = {
  exposed: new Map<string, unknown>(),
  exposeInMainWorld(name: string, value: unknown): void {
    contextBridge.exposed.set(name, value);
  },
};

export const ipcRenderer = new EventEmitter();

/** Put every stand-in back the way a fresh process would find it. */
export function resetFakeElectron(): void {
  app.removeAllListeners();
  app.ready = false;
  app.version = "1.2.3";
  app.name = "Fake";
  app.singleInstanceLock = true;
  app.quitCalls = 0;
  app.paths = { appData: "/fake/appData" };
  ipcMain.handlers.clear();
  powerMonitor.removeAllListeners();
  protocol.privileged.length = 0;
  protocol.handlers = new Map();
  session.defaultSession.requestHandler = undefined;
  session.defaultSession.checkHandler = undefined;
  FakeMenu.applicationMenu = "electron-default";
  FakeMenu.built.length = 0;
  FakeBrowserWindow.created.length = 0;
  shell.opened.length = 0;
  contextBridge.exposed.clear();
  net.respond = (url: string): Promise<Response> =>
    Promise.resolve(new Response(`file:${url}`, { status: 200 }));
}

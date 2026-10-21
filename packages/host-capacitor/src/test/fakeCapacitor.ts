/**
 * What the unit tests read in place of `@capacitor/core` and the three
 * plugins. The real packages answer through a native bridge that exists only
 * inside an app, so every test runs against this.
 */

/** What the app this stand-in plays reports about itself. */
export const shell = {
  native: true,
  platform: "ios" as string,
  plugins: new Set(["App", "Filesystem", "ScreenOrientation"]),
  /** Whether the app is a debug build. */
  debug: false,
};

export const Capacitor = {
  isNativePlatform: (): boolean => shell.native,
  getPlatform: (): string => shell.platform,
  isPluginAvailable: (name: string): boolean => shell.plugins.has(name),
  get DEBUG(): boolean {
    return shell.debug;
  },
};

// A Capacitor app injects this object into the page before any script runs,
// and @capacitor/core installs one on a plain page too.
(globalThis as { Capacitor?: unknown }).Capacitor = Capacitor;

export interface PluginListenerHandle {
  remove(): Promise<void>;
}

/** The asynchronous calls of the App plugin a test can hold. */
export type AppCall =
  | "addListener:appStateChange"
  | "addListener:pause"
  | "addListener:resume"
  | "addListener:backButton"
  | "getInfo"
  | "getState";

type Listener = (payload: never) => void;

/** What the App plugin reports and what it was asked, per test. */
export const app = {
  info: { name: "Fake", id: "dev.yage.fake", version: "1.0", build: "1" } as {
    name: string;
    id: string;
    version: unknown;
    build: unknown;
  },
  state: { isActive: true },
  /** The event names whose listeners were removed, in order. */
  removed: [] as string[],
  /** Every promise a `remove()` handed out, so a test can read its outcome. */
  removals: [] as Promise<void>[],
  /** The event names whose `remove()` rejects. */
  removeRejects: new Set<string>(),
  minimizeCalls: 0,
  listeners: new Map<string, Set<Listener>>(),
  holds: new Map<AppCall, Promise<void>>(),
  /** Every asynchronous call the adapter started, in order. */
  started: [] as AppCall[],
};

/** Hold every later call of `name` until the returned function is called. */
export function holdApp(name: AppCall): () => void {
  let release = (): void => {};
  app.holds.set(
    name,
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  return () => {
    app.holds.delete(name);
    release();
  };
}

async function reachCall(name: AppCall): Promise<void> {
  app.started.push(name);
  await app.holds.get(name);
}

/** Send one event to every listener registered for it. */
export function emitApp(eventName: string, payload?: unknown): void {
  for (const listener of [...(app.listeners.get(eventName) ?? [])]) {
    (listener as (value: unknown) => void)(payload);
  }
}

/** How many listeners an event has. */
export function listenerCount(eventName: string): number {
  return app.listeners.get(eventName)?.size ?? 0;
}

export const App = {
  async addListener(
    eventName: string,
    listener: Listener,
  ): Promise<PluginListenerHandle> {
    await reachCall(`addListener:${eventName}` as AppCall);
    let set = app.listeners.get(eventName);
    if (set === undefined) {
      set = new Set();
      app.listeners.set(eventName, set);
    }
    set.add(listener);
    return {
      remove(): Promise<void> {
        app.removed.push(eventName);
        set.delete(listener);
        const outcome = app.removeRejects.has(eventName)
          ? Promise.reject(
              new Error(`fake: removing the ${eventName} listener failed.`),
            )
          : Promise.resolve();
        app.removals.push(outcome);
        return outcome;
      },
    };
  },
  async getInfo(): Promise<{
    name: string;
    id: string;
    version: string;
    build: string;
  }> {
    await reachCall("getInfo");
    return app.info as {
      name: string;
      id: string;
      version: string;
      build: string;
    };
  },
  async getState(): Promise<{ isActive: boolean }> {
    await reachCall("getState");
    return app.state;
  },
  minimizeApp(): Promise<void> {
    app.minimizeCalls += 1;
    return Promise.resolve();
  },
};

/** Where the Filesystem plugin writes. Only the app's Library is used. */
export enum Directory {
  Documents = "DOCUMENTS",
  Data = "DATA",
  Library = "LIBRARY",
  Cache = "CACHE",
  External = "EXTERNAL",
  ExternalStorage = "EXTERNAL_STORAGE",
  ExternalCache = "EXTERNAL_CACHE",
  LibraryNoCloud = "LIBRARY_NO_CLOUD",
  Temporary = "TEMPORARY",
}

export enum Encoding {
  UTF8 = "utf8",
  ASCII = "ascii",
  UTF16 = "utf16",
}

/** One recorded call of the Filesystem plugin. */
export interface FilesystemCall {
  method: string;
  options: Record<string, unknown>;
}

/** The file tree and the calls made on it. Each file holds bytes. */
export const files = {
  content: new Map<string, Uint8Array>(),
  directories: new Set<string>(),
  calls: [] as FilesystemCall[],
  /** The method names that reject with `failure` instead of answering. */
  failing: new Set<string>(),
  failure: Object.assign(new Error("fake: the storage is full."), {
    code: "OS-PLUG-FILE-0005",
  }),
  /** The data `readFile` answers with, when a test replaces the string. */
  data: undefined as unknown,
};

function missing(path: string): Error {
  return Object.assign(new Error(`fake: ${path} does not exist.`), {
    code: "OS-PLUG-FILE-0008",
  });
}

function record(method: string, options: Record<string, unknown>): void {
  files.calls.push({ method, options });
  if (files.failing.has(method)) throw files.failure;
}

function parentOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

/** The text a file holds, read as UTF-8, or `undefined` when there is no file. */
export function fileText(path: string): string | undefined {
  const bytes = files.content.get(path);
  return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
}

export const Filesystem = {
  async readFile(options: Record<string, unknown>): Promise<{ data: unknown }> {
    record("readFile", options);
    const path = String(options["path"]);
    const bytes = files.content.get(path);
    if (bytes === undefined) throw missing(path);
    if (files.data !== undefined) return { data: files.data };
    // With no encoding the plugin answers with the bytes as base64.
    if (options["encoding"] === undefined) {
      return { data: btoa(String.fromCharCode(...bytes)) };
    }
    // The plugin's UTF-8 read rejects bytes that are not UTF-8.
    try {
      return { data: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
    } catch {
      throw Object.assign(new Error(`fake: ${path} is not UTF-8.`), {
        code: "OS-PLUG-FILE-0013",
      });
    }
  },
  async writeFile(options: Record<string, unknown>): Promise<{ uri: string }> {
    record("writeFile", options);
    const path = String(options["path"]);
    files.directories.add(parentOf(path));
    files.content.set(path, new TextEncoder().encode(String(options["data"])));
    return { uri: `library://${path}` };
  },
  async deleteFile(options: Record<string, unknown>): Promise<void> {
    record("deleteFile", options);
    const path = String(options["path"]);
    if (!files.content.has(path)) throw missing(path);
    files.content.delete(path);
  },
  async readdir(
    options: Record<string, unknown>,
  ): Promise<{ files: { name: string }[] }> {
    record("readdir", options);
    const path = String(options["path"]);
    if (!files.directories.has(path)) throw missing(path);
    const names: { name: string }[] = [];
    for (const key of files.content.keys()) {
      if (parentOf(key) === path) {
        names.push({ name: key.slice(path.length + 1) });
      }
    }
    return { files: names };
  },
};

/** What the orientation plugin was asked, and how it answers. */
export const orientation = {
  locks: [] as string[],
  unlocks: 0,
  lockRejection: undefined as Error | undefined,
};

export const ScreenOrientation = {
  lock(options: { orientation: string }): Promise<void> {
    orientation.locks.push(options.orientation);
    return orientation.lockRejection === undefined
      ? Promise.resolve()
      : Promise.reject(orientation.lockRejection);
  },
  unlock(): Promise<void> {
    orientation.unlocks += 1;
    return Promise.resolve();
  },
};

/** Put every part of the stand-in back to what a fresh app reports. */
export function resetCapacitor(): void {
  shell.native = true;
  shell.platform = "ios";
  shell.plugins = new Set(["App", "Filesystem", "ScreenOrientation"]);
  shell.debug = false;
  app.info = { name: "Fake", id: "dev.yage.fake", version: "1.0", build: "1" };
  app.state = { isActive: true };
  app.removed = [];
  app.removals = [];
  app.removeRejects = new Set();
  app.minimizeCalls = 0;
  app.listeners = new Map();
  app.holds = new Map();
  app.started = [];
  files.content = new Map();
  files.directories = new Set();
  files.calls = [];
  files.failing = new Set();
  files.data = undefined;
  orientation.locks = [];
  orientation.unlocks = 0;
  orientation.lockRejection = undefined;
}

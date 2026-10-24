import { execFile, execFileSync, spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { nativeDir, workDir } from "./paths.js";

const run = promisify(execFile);

/** The identifier the generated app is installed under. */
export const APP_ID = "dev.yage.baseline";

/** The simulator a run used. */
export interface SimulatorDevice {
  name: string;
  udid: string;
  runtime: string;
  kind: "simulator";
}

/**
 * The Xcode installation every command runs against. The suite reads it from
 * the environment; it never changes the machine's selected toolchain.
 */
export function developerDir(): string {
  const value = process.env["DEVELOPER_DIR"];
  if (value === undefined || !value.endsWith(".app/Contents/Developer")) {
    throw new Error(
      "ios: set DEVELOPER_DIR to an Xcode Developer directory, for example " +
        "DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer. " +
        "The native suite never changes xcode-select.",
    );
  }
  return value;
}

function toolEnv(): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    DEVELOPER_DIR: developerDir(),
    // The Capacitor CLI records a setting and sends a metric only from an
    // interactive terminal; this keeps it out of one.
    CI: "1",
  };
}

const capacitorDir = resolve(nativeDir, "capacitor");
const iosProjectDir = resolve(workDir, "ios");
const derivedDataDir = resolve(workDir, "ios-derived");

/** The Xcode build configuration a profile is built with. */
export type IosConfiguration = "Debug" | "Release";

/**
 * Generate the native project when it is absent, copy the built web
 * directory into it, build it for the simulator and return the built app.
 */
export async function prepareIosApp(
  configuration: IosConfiguration,
): Promise<string> {
  const env = toolEnv();
  const cli = resolve(capacitorDir, "node_modules/.bin/cap");
  if (!existsSync(iosProjectDir)) {
    await run(cli, ["add", "ios", "--packagemanager", "SPM"], {
      cwd: capacitorDir,
      env,
      maxBuffer: 1 << 26,
    });
  }
  await run(cli, ["sync", "ios"], {
    cwd: capacitorDir,
    env,
    maxBuffer: 1 << 26,
  });
  await run(
    "xcodebuild",
    [
      "-project",
      resolve(iosProjectDir, "App/App.xcodeproj"),
      "-scheme",
      "App",
      "-configuration",
      configuration,
      "-sdk",
      "iphonesimulator",
      "-destination",
      "generic/platform=iOS Simulator",
      "-derivedDataPath",
      derivedDataDir,
      "CODE_SIGNING_ALLOWED=NO",
      "build",
    ],
    { env, maxBuffer: 1 << 28 },
  );
  const app = resolve(
    derivedDataDir,
    `Build/Products/${configuration}-iphonesimulator/App.app`,
  );
  if (!existsSync(app)) {
    throw new Error(`prepareIosApp: the build produced no app at ${app}.`);
  }
  return app;
}

interface SimctlDevice {
  name: string;
  udid: string;
  state: string;
  isAvailable?: boolean;
}

/**
 * The simulator to run on: the one `BASELINE_SIMULATOR` names, else the
 * newest available iPhone 17. Boots it when it is shut down.
 */
export function selectSimulator(): SimulatorDevice {
  const env = toolEnv();
  const listed = JSON.parse(
    execFileSync("xcrun", ["simctl", "list", "devices", "--json"], {
      env,
      encoding: "utf8",
      maxBuffer: 1 << 26,
    }),
  ) as { devices: Record<string, SimctlDevice[]> };
  const wanted = process.env["BASELINE_SIMULATOR"];
  const runtimes = Object.keys(listed.devices).sort().reverse();
  let found: { device: SimctlDevice; runtime: string } | undefined;
  for (const runtime of runtimes) {
    for (const device of listed.devices[runtime] ?? []) {
      if (device.isAvailable === false) continue;
      const matches =
        wanted === undefined
          ? device.name === "iPhone 17"
          : device.name === wanted || device.udid === wanted;
      if (matches) {
        found = { device, runtime };
        break;
      }
    }
    if (found) break;
  }
  if (!found) {
    throw new Error(
      `selectSimulator: no available simulator matches ` +
        `${JSON.stringify(wanted ?? "iPhone 17")}.`,
    );
  }
  if (found.device.state !== "Booted") {
    execFileSync("xcrun", ["simctl", "boot", found.device.udid], { env });
    execFileSync("xcrun", ["simctl", "bootstatus", found.device.udid, "-b"], {
      env,
    });
  }
  return {
    name: found.device.name,
    udid: found.device.udid,
    runtime: found.runtime,
    kind: "simulator",
  };
}

/** Remove any installed copy and install this build, so the app starts clean. */
export async function installClean(
  udid: string,
  app: string,
  bundleId: string = APP_ID,
): Promise<void> {
  const env = toolEnv();
  // An absent app is not an error for the simulator; a stale one would keep
  // the previous run's stored data.
  await run("xcrun", ["simctl", "uninstall", udid, bundleId], { env }).catch(
    () => undefined,
  );
  await run("xcrun", ["simctl", "install", udid, app], {
    env,
    maxBuffer: 1 << 26,
  });
}

/** A launched app whose log lines a caller reads. */
export interface LaunchedApp {
  /** Every line the app has written so far. */
  readonly lines: readonly string[];
  /** Wait until one line satisfies `predicate`, or fail after `timeoutMs`. */
  waitFor(
    predicate: (line: string) => boolean,
    timeoutMs: number,
  ): Promise<string>;
  close(): void;
}

/**
 * Launch the app with its log attached. A Debug build forwards the page's
 * console output here; a Release build writes nothing of its own.
 */
export function launchWithConsole(
  udid: string,
  bundleId: string = APP_ID,
): LaunchedApp {
  const child: ChildProcessWithoutNullStreams = spawn(
    "xcrun",
    [
      "simctl",
      "launch",
      "--console-pty",
      "--terminate-running-process",
      udid,
      bundleId,
    ],
    { env: toolEnv() },
  );
  const lines: string[] = [];
  const waiters: {
    match: (line: string) => boolean;
    take: (line: string) => void;
    fail: (error: Error) => void;
  }[] = [];
  let pending = "";
  /** Why the launch process ended, once it has. */
  let ended: string | null = null;
  const consume = (chunk: string): void => {
    pending += chunk;
    const parts = pending.split("\n");
    pending = parts.pop() ?? "";
    for (const line of parts) {
      lines.push(line);
      for (const waiter of [...waiters]) {
        if (waiter.match(line)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.take(line);
        }
      }
    }
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", consume);
  child.stderr.on("data", consume);
  // "close" fires once both streams are read to the end, so every line the
  // app wrote has reached a waiter by then.
  child.on("close", (code, signal) => {
    ended = `simctl launch exited with ${signal ?? `code ${String(code)}`}`;
    for (const waiter of waiters.splice(0)) {
      waiter.fail(
        new Error(`launchWithConsole: ${ended} before a matching line.`),
      );
    }
  });

  return {
    lines,
    waitFor(predicate, timeoutMs) {
      const already = lines.find((line) => predicate(line));
      if (already !== undefined) return Promise.resolve(already);
      if (ended !== null) {
        return Promise.reject(
          new Error(`launchWithConsole: ${ended} before a matching line.`),
        );
      }
      return new Promise<string>((done, fail) => {
        const waiter = {
          match: predicate,
          take: (line: string) => {
            clearTimeout(timer);
            done(line);
          },
          fail: (error: Error) => {
            clearTimeout(timer);
            fail(error);
          },
        };
        const timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          fail(
            new Error(
              `launchWithConsole: no matching line within ${timeoutMs} ms.`,
            ),
          );
        }, timeoutMs);
        waiters.push(waiter);
      });
    },
    close() {
      child.kill("SIGTERM");
    },
  };
}

/** Bring the app to the front without restarting it. */
export async function bringToFront(udid: string): Promise<void> {
  await run("xcrun", ["simctl", "launch", udid, APP_ID], { env: toolEnv() });
}

/** Send the app to the background by bringing another app to the front. */
export async function sendToBackground(udid: string): Promise<void> {
  await run("xcrun", ["simctl", "launch", udid, "com.apple.mobilesafari"], {
    env: toolEnv(),
  });
}

/** Stop the app. */
export async function terminate(
  udid: string,
  bundleId: string = APP_ID,
): Promise<void> {
  await run("xcrun", ["simctl", "terminate", udid, bundleId], {
    env: toolEnv(),
  }).catch(() => undefined);
}

/**
 * The process id of the app on the simulator, or `null` when it is not
 * running. `launchctl list` prints one row per job, `<pid>\t<status>\t<label>`,
 * with `-` in place of the pid for a job that has no process.
 */
export async function processId(
  udid: string,
  bundleId: string = APP_ID,
): Promise<number | null> {
  const { stdout } = await run(
    "xcrun",
    ["simctl", "spawn", udid, "launchctl", "list"],
    { env: toolEnv(), maxBuffer: 1 << 26 },
  );
  for (const row of stdout.split("\n")) {
    const [pid = "", , label = ""] = row.split("\t");
    if (!label.startsWith(`UIKitApplication:${bundleId}[`)) continue;
    return /^\d+$/.test(pid) ? Number(pid) : null;
  }
  return null;
}

/** Whether the app's process is running on the simulator. */
export async function isRunning(udid: string): Promise<boolean> {
  return (await processId(udid)) !== null;
}

/** Where the installed app keeps the files it writes. */
export async function appDataDir(udid: string): Promise<string> {
  const { stdout } = await run(
    "xcrun",
    ["simctl", "get_app_container", udid, APP_ID, "data"],
    { env: toolEnv() },
  );
  return stdout.trim();
}

/** Save a screenshot of the simulator's screen. */
export async function screenshot(udid: string, path: string): Promise<void> {
  await run("xcrun", ["simctl", "io", udid, "screenshot", path], {
    env: toolEnv(),
  });
}

/** The versions of the Capacitor packages and Xcode this run used. */
export function iosToolVersions(): Record<string, string> {
  const versions: Record<string, string> = {};
  for (const name of [
    "@capacitor/cli",
    "@capacitor/core",
    "@capacitor/ios",
    "@capacitor/app",
    "@capacitor/filesystem",
    "@capacitor/screen-orientation",
  ]) {
    const manifest = resolve(
      capacitorDir,
      "node_modules",
      name,
      "package.json",
    );
    try {
      versions[name] = (
        JSON.parse(readFileSync(manifest, "utf8")) as { version: string }
      ).version;
    } catch {
      versions[name] = "not resolved";
    }
  }
  versions["xcodebuild"] = execFileSync("xcodebuild", ["-version"], {
    env: toolEnv(),
    encoding: "utf8",
  })
    .trim()
    .replace(/\n/g, " ");
  return versions;
}

import { createRequire } from "node:module";
import { mkdtemp } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { _electron as electron } from "@playwright/test";
import type { ElectronApplication } from "@playwright/test";
import { nativeDir, repoRoot, workDir } from "./paths.js";

/**
 * The Electron binary, resolved from the host package: the shell runs the
 * version that package compiles and tests against. The first run downloads
 * the binary through Electron's own installer.
 */
export function electronBinary(): string {
  const manifest = resolve(repoRoot, "packages/host-electron/package.json");
  try {
    const from = createRequire(manifest);
    const binary = from("electron") as unknown;
    if (typeof binary !== "string") {
      throw new Error("the installed package reported no binary path");
    }
    return binary;
  } catch {
    throw new Error(
      "electronBinary: Electron is not installed. " +
        "Run npm install at the repository root.",
    );
  }
}

/** A directory the shell keeps its stored data in, fresh for each profile. */
export async function newAppDataDir(): Promise<string> {
  const parent = resolve(workDir, "electron-profiles");
  mkdirSync(parent, { recursive: true });
  return mkdtemp(resolve(parent, "profile-"));
}

/** What a launch needs. */
export interface ElectronLaunchOptions {
  /** The built web directory, or an archive holding one, that the shell serves. */
  readonly webDir: string;
  /** The application-data directory, kept across a relaunch on the same profile. */
  readonly appData: string;
  /** Which build the shell says it runs; names the save directory. */
  readonly profile: string;
  /** Appended to the page's URL. */
  readonly query?: string;
  /** The shell directory to launch, for a copy under another app name. */
  readonly shellDir?: string;
}

/** The environment one launch reads. */
export function launchEnvironment(
  options: ElectronLaunchOptions,
): Record<string, string> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    YAGE_BASELINE_WEB: options.webDir,
    YAGE_BASELINE_APP_DATA: options.appData,
    YAGE_BASELINE_PROFILE: options.profile,
    YAGE_BASELINE_QUERY: options.query ?? "",
  };
  delete env["ELECTRON_RUN_AS_NODE"];
  return env;
}

/**
 * Start the test shell on one built web directory. Electron is launched on
 * the shell's directory rather than its script, so it reads the shell's
 * `package.json` for the app's name and version.
 */
export function launchElectron(
  options: ElectronLaunchOptions,
): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: electronBinary(),
    args: [options.shellDir ?? resolve(nativeDir, "electron")],
    env: launchEnvironment(options),
  });
}

import { createRequire } from "node:module";
import { mkdtemp } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { _electron as electron } from "@playwright/test";
import type { ElectronApplication } from "@playwright/test";
import { nativeDir, workDir } from "./paths.js";

/** The Electron binary the test shell installed. */
export function electronBinary(): string {
  const shellManifest = resolve(nativeDir, "electron/package.json");
  try {
    const from = createRequire(shellManifest);
    const binary = from("electron") as unknown;
    if (typeof binary !== "string") {
      throw new Error("the installed package reported no binary path");
    }
    return binary;
  } catch {
    throw new Error(
      "electronBinary: Electron is not installed for the native suite. " +
        "Run npm --prefix e2e/native/electron ci.",
    );
  }
}

/** A directory the shell keeps its stored data in, fresh for each profile. */
export async function newUserDataDir(): Promise<string> {
  const parent = resolve(workDir, "electron-profiles");
  mkdirSync(parent, { recursive: true });
  return mkdtemp(resolve(parent, "profile-"));
}

/** What a launch needs. */
export interface ElectronLaunchOptions {
  /** The built web directory the shell serves. */
  readonly webDir: string;
  /** The stored-data directory, kept across a relaunch on the same profile. */
  readonly userData: string;
  /** Appended to the page's URL. */
  readonly query?: string;
}

/** Start the test shell on one built web directory. */
export function launchElectron(
  options: ElectronLaunchOptions,
): Promise<ElectronApplication> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    YAGE_BASELINE_WEB: options.webDir,
    YAGE_BASELINE_USER_DATA: options.userData,
    YAGE_BASELINE_QUERY: options.query ?? "",
  };
  delete env["ELECTRON_RUN_AS_NODE"];
  return electron.launch({
    executablePath: electronBinary(),
    args: [resolve(nativeDir, "electron/main.cjs")],
    env,
  });
}

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { buildBaseline } from "./build.js";
import { nativeDir, workDir } from "./paths.js";

const run = promisify(execFile);

const capacitorDir = resolve(nativeDir, "capacitor");

/** Where the Android project is generated. */
export const androidProjectDir = resolve(workDir, "android");

/**
 * The environment the Capacitor CLI generates an Android project in. No
 * Xcode setting reaches it: generating and synchronizing a project copies
 * files and writes Gradle settings, and runs no build.
 */
function toolEnv(): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    // The Capacitor CLI records a setting and sends a metric only from an
    // interactive terminal; this keeps it out of one.
    CI: "1",
  };
}

/**
 * Generate the Android project when it is absent and copy the built web
 * directory into it. Returns the project's path.
 */
export async function prepareAndroidProject(): Promise<string> {
  const env = toolEnv();
  const cli = resolve(capacitorDir, "node_modules/.bin/cap");
  // The copy step refuses a web directory without an index page, and the
  // Capacitor project points both systems at one built directory.
  await buildBaseline("capacitor", "test");
  if (!existsSync(androidProjectDir)) {
    await run(cli, ["add", "android"], {
      cwd: capacitorDir,
      env,
      maxBuffer: 1 << 26,
    });
  }
  await run(cli, ["sync", "android"], {
    cwd: capacitorDir,
    env,
    maxBuffer: 1 << 26,
  });
  return androidProjectDir;
}

/** What a generated Android project states about the app it builds. */
export interface AndroidProjectFacts {
  minSdk: number | null;
  compileSdk: number | null;
  targetSdk: number | null;
  /** The configuration changes the main activity handles without restarting. */
  configChanges: string[];
  launchMode: string | null;
  /** The plugin projects Gradle includes. */
  plugins: string[];
  /** Whether the built page is in the project's assets. */
  webIndex: boolean;
  appCategory: string | null;
  largeHeap: string | null;
}

function readNumber(source: string, name: string): number | null {
  const found = new RegExp(`${name}\\s*=\\s*(\\d+)`).exec(source);
  return found === null ? null : Number(found[1]);
}

function readAttribute(source: string, name: string): string | null {
  const found = new RegExp(`${name}="([^"]*)"`).exec(source);
  return found === null ? null : (found[1] ?? null);
}

/** Read what the generated project says, without building it. */
export function readAndroidProject(dir: string): AndroidProjectFacts {
  const variables = readFileSync(resolve(dir, "variables.gradle"), "utf8");
  const manifest = readFileSync(
    resolve(dir, "app/src/main/AndroidManifest.xml"),
    "utf8",
  );
  const settings = readFileSync(
    resolve(dir, "capacitor.settings.gradle"),
    "utf8",
  );
  const configChanges = readAttribute(manifest, "android:configChanges");
  return {
    minSdk: readNumber(variables, "minSdkVersion"),
    compileSdk: readNumber(variables, "compileSdkVersion"),
    targetSdk: readNumber(variables, "targetSdkVersion"),
    configChanges: configChanges === null ? [] : configChanges.split("|"),
    launchMode: readAttribute(manifest, "android:launchMode"),
    plugins: [...settings.matchAll(/include ':([^']+)'/g)].map(
      (found) => found[1] ?? "",
    ),
    webIndex: existsSync(resolve(dir, "app/src/main/assets/public/index.html")),
    appCategory: readAttribute(manifest, "android:appCategory"),
    largeHeap: readAttribute(manifest, "android:largeHeap"),
  };
}

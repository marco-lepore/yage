import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Target } from "./types.js";

/** Where each Capacitor platform keeps the files this tool reads. */
export interface NativePaths {
  /** The Xcode project file, or the app module's Gradle file. */
  readonly project: string;
  /** The configuration `npx cap sync` copies into the native project. */
  readonly config: string;
}

export function nativePaths(root: string, target: Target): NativePaths {
  return target === "ios"
    ? {
        project: path.join(
          root,
          "ios",
          "App",
          "App.xcodeproj",
          "project.pbxproj",
        ),
        config: path.join(root, "ios", "App", "App", "capacitor.config.json"),
      }
    : {
        project: path.join(root, "android", "app", "build.gradle"),
        config: path.join(
          root,
          "android",
          "app",
          "src",
          "main",
          "assets",
          "capacitor.config.json",
        ),
      };
}

/** The Android manifest a Capacitor project generates. */
export function androidManifest(root: string): string {
  return path.join(
    root,
    "android",
    "app",
    "src",
    "main",
    "AndroidManifest.xml",
  );
}

/** The iOS privacy manifest, which the App target has to carry. */
export function privacyManifest(root: string): string {
  return path.join(root, "ios", "App", "App", "PrivacyInfo.xcprivacy");
}

/** The configuration the last sync copied, or `undefined` when there is none. */
export function readCopiedConfig(
  root: string,
  target: Target,
): Record<string, unknown> | undefined {
  const file = nativePaths(root, target).config;
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

/** A nested value of a plain object, by its dotted path. */
export function at(
  source: Record<string, unknown> | undefined,
  dotted: string,
): unknown {
  let value: unknown = source;
  for (const key of dotted.split(".")) {
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/**
 * A build setting of the Xcode project, as the App target sets it. A
 * Capacitor project has the one app target, and its settings appear once per
 * build configuration with the same value.
 */
export function xcodeSetting(
  projectFile: string,
  name: string,
): string | undefined {
  if (!existsSync(projectFile)) return undefined;
  const source = readFileSync(projectFile, "utf8");
  const match = new RegExp(`\\b${name}\\s*=\\s*([^;\\n]+);`).exec(source);
  if (match === null) return undefined;
  return match[1]?.trim().replace(/^"(.*)"$/, "$1");
}

/** Whether the Xcode project references a file by name. */
export function xcodeReferences(projectFile: string, file: string): boolean {
  if (!existsSync(projectFile)) return false;
  return readFileSync(projectFile, "utf8").includes(file);
}

/** A property of the app module's Gradle file, such as `applicationId`. */
export function gradleSetting(
  gradleFile: string,
  name: string,
): string | undefined {
  if (!existsSync(gradleFile)) return undefined;
  const source = readFileSync(gradleFile, "utf8");
  const match = new RegExp(`\\b${name}\\s+("?)([^"\\n]+)\\1`).exec(source);
  if (match === null) return undefined;
  return match[2]?.trim();
}

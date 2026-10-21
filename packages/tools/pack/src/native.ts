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

/** A build setting read from the Xcode project, or why it cannot be read. */
export type XcodeSetting =
  | { readonly value: string }
  | { readonly unreadable: string };

/**
 * A build setting of the App target's Release configuration, the one a
 * release archive builds with. A value the target inherits from the project
 * or an xcconfig file, or builds from other settings, is unreadable: the
 * project file alone does not hold it.
 */
export function xcodeSetting(projectFile: string, name: string): XcodeSetting {
  if (!existsSync(projectFile)) {
    return { unreadable: "project.pbxproj is missing" };
  }
  let parsed: PlistValue;
  try {
    parsed = parsePlist(readFileSync(projectFile, "utf8"));
  } catch {
    return { unreadable: "project.pbxproj cannot be parsed" };
  }
  const objects = asDict(asDict(parsed)?.objects) ?? {};
  const target = Object.values(objects)
    .map(asDict)
    .find((entry) => entry?.isa === "PBXNativeTarget" && entry.name === "App");
  const listId = target?.buildConfigurationList;
  const list = typeof listId === "string" ? asDict(objects[listId]) : undefined;
  const ids = Array.isArray(list?.buildConfigurations)
    ? list.buildConfigurations
    : [];
  const release = ids
    .map((id) => (typeof id === "string" ? asDict(objects[id]) : undefined))
    .find((entry) => entry?.name === "Release");
  if (release === undefined) {
    return {
      unreadable: "the project has no App target with a Release configuration",
    };
  }
  const value = asDict(release.buildSettings)?.[name];
  if (typeof value !== "string") {
    return {
      unreadable:
        "the App target's Release configuration does not set it, so any value comes from the project or an xcconfig file",
    };
  }
  if (value.includes("$(") || value.includes("${")) {
    return {
      unreadable: `the App target's Release configuration sets it to ${value}, which refers to other settings`,
    };
  }
  return { value };
}

type PlistValue =
  | string
  | readonly PlistValue[]
  | { readonly [key: string]: PlistValue };

function asDict(
  value: PlistValue | undefined,
): { readonly [key: string]: PlistValue } | undefined {
  return typeof value === "object" && !Array.isArray(value)
    ? (value as { readonly [key: string]: PlistValue })
    : undefined;
}

/**
 * Parse the old-style property list an Xcode project file is written in:
 * `{ key = value; }` dictionaries, `( value, )` arrays, quoted or bare strings,
 * and comments.
 */
function parsePlist(source: string): PlistValue {
  let at = 0;
  const unexpected = (): Error =>
    new Error(`parsePlist: unexpected input at offset ${at}`);
  const skip = (): void => {
    for (;;) {
      while (at < source.length && /\s/.test(source.charAt(at))) at++;
      if (source.startsWith("/*", at)) {
        const end = source.indexOf("*/", at + 2);
        if (end < 0) throw unexpected();
        at = end + 2;
      } else if (source.startsWith("//", at)) {
        const end = source.indexOf("\n", at);
        at = end < 0 ? source.length : end + 1;
      } else {
        return;
      }
    }
  };
  const take = (char: string): void => {
    skip();
    if (source.charAt(at) !== char) throw unexpected();
    at++;
  };
  const text = (): string => {
    skip();
    if (source.charAt(at) === '"') {
      let out = "";
      for (at++; source.charAt(at) !== '"'; at++) {
        if (at >= source.length) throw unexpected();
        if (source.charAt(at) === "\\") at++;
        out += source.charAt(at);
      }
      at++;
      return out;
    }
    const bare = /[^\s{}();,="]+/y;
    bare.lastIndex = at;
    const match = bare.exec(source);
    if (match === null) throw unexpected();
    at = bare.lastIndex;
    return match[0];
  };
  const value = (): PlistValue => {
    skip();
    if (source.charAt(at) === "{") {
      at++;
      const dict: { [key: string]: PlistValue } = {};
      for (skip(); source.charAt(at) !== "}"; skip()) {
        const key = text();
        take("=");
        dict[key] = value();
        take(";");
      }
      at++;
      return dict;
    }
    if (source.charAt(at) === "(") {
      at++;
      const list: PlistValue[] = [];
      for (skip(); source.charAt(at) !== ")"; skip()) {
        list.push(value());
        skip();
        if (source.charAt(at) === ",") at++;
        else if (source.charAt(at) !== ")") throw unexpected();
      }
      at++;
      return list;
    }
    return text();
  };
  return value();
}

/**
 * Whether a target of the Xcode project copies a file into the app. Xcode
 * writes a `<file> in Resources` build-file entry for each file a target
 * copies, and only a file reference for a file no target copies.
 */
export function xcodeCopiesResource(
  projectFile: string,
  file: string,
): boolean {
  if (!existsSync(projectFile)) return false;
  return readFileSync(projectFile, "utf8").includes(
    `/* ${file} in Resources */`,
  );
}

/**
 * A property of the app module's Gradle file, such as `applicationId`, in
 * Groovy's `name value` form or the `name = value` form.
 */
export function gradleSetting(
  gradleFile: string,
  name: string,
): string | undefined {
  if (!existsSync(gradleFile)) return undefined;
  const source = readFileSync(gradleFile, "utf8");
  const match = new RegExp(
    `\\b${name}(?:\\s*=\\s*|\\s+)("?)([^"\\n]+)\\1`,
  ).exec(source);
  if (match === null) return undefined;
  return match[2]?.trim();
}

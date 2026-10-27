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

/** The configurations of the App target a Capacitor project generates. */
export type XcodeConfiguration = "Debug" | "Release";

/**
 * A build setting of one configuration of the App target: Release is the one
 * a release archive builds with, Debug the one a development build runs. A
 * value the target inherits from the project or an xcconfig file, or builds
 * from other settings, is unreadable: the project file alone does not hold it.
 */
export function xcodeSetting(
  projectFile: string,
  configuration: XcodeConfiguration,
  name: string,
): XcodeSetting {
  const project = readXcodeProject(projectFile);
  if ("unreadable" in project) return project;
  const { objects, target } = project;
  const list = objectAt(objects, target?.buildConfigurationList);
  const found = objectsAt(objects, list?.buildConfigurations).find(
    (entry) => entry.name === configuration,
  );
  if (found === undefined) {
    return {
      unreadable: `the project has no App target with a ${configuration} configuration`,
    };
  }
  const value = asDict(found.buildSettings)?.[name];
  if (typeof value !== "string") {
    return {
      unreadable: `the App target's ${configuration} configuration does not set it, so any value comes from the project or an xcconfig file`,
    };
  }
  if (value.includes("$(") || value.includes("${")) {
    return {
      unreadable: `the App target's ${configuration} configuration sets it to ${value}, which refers to other settings`,
    };
  }
  return { value };
}

type PlistValue = string | readonly PlistValue[] | PlistDict;

type PlistDict = { readonly [key: string]: PlistValue };

function asDict(value: PlistValue | undefined): PlistDict | undefined {
  return typeof value === "object" && !Array.isArray(value)
    ? (value as PlistDict)
    : undefined;
}

/** The objects of an Xcode project and its App target, or why it cannot be read. */
type XcodeProject =
  | { readonly objects: PlistDict; readonly target: PlistDict | undefined }
  | { readonly unreadable: string };

function readXcodeProject(projectFile: string): XcodeProject {
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
  return { objects, target };
}

/** The project object an id names, or `undefined` for an id it does not hold. */
function objectAt(
  objects: PlistDict,
  id: PlistValue | undefined,
): PlistDict | undefined {
  return typeof id === "string" ? asDict(objects[id]) : undefined;
}

/** The project objects a list of ids names, leaving out ids it does not hold. */
function objectsAt(
  objects: PlistDict,
  ids: PlistValue | undefined,
): PlistDict[] {
  return (Array.isArray(ids) ? ids : []).flatMap(
    (id: PlistValue): PlistDict[] => {
      const found = objectAt(objects, id);
      return found === undefined ? [] : [found];
    },
  );
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
 * Whether the App target of the Xcode project copies a file into the app: one
 * of the build files in the target's Resources build phase refers to a file
 * reference whose `path` or `name` is the file. The answer is `false` for a
 * project file that is missing or cannot be parsed.
 */
export function xcodeCopiesResource(
  projectFile: string,
  file: string,
): boolean {
  const project = readXcodeProject(projectFile);
  if ("unreadable" in project) return false;
  const { objects, target } = project;
  return objectsAt(objects, target?.buildPhases)
    .filter((phase) => phase.isa === "PBXResourcesBuildPhase")
    .flatMap((phase) => objectsAt(objects, phase.files))
    .map((buildFile) => objectAt(objects, buildFile.fileRef))
    .some(
      (reference) =>
        reference?.isa === "PBXFileReference" &&
        (reference.path === file || reference.name === file),
    );
}

/**
 * The string literals and comments of a Gradle file. A string is matched
 * first, so a `//` or `/*` inside one does not start a comment.
 */
const GRADLE_STRINGS_AND_COMMENTS =
  /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/g;

/**
 * A property of the app module's Gradle file, such as `applicationId`, in
 * Groovy's `name value` form or the `name = value` form. The value is
 * double-quoted, single-quoted or bare. Comments are skipped, and the first
 * line that sets the property gives its value.
 */
export function gradleSetting(
  gradleFile: string,
  name: string,
): string | undefined {
  if (!existsSync(gradleFile)) return undefined;
  const source = readFileSync(gradleFile, "utf8").replace(
    GRADLE_STRINGS_AND_COMMENTS,
    (token) => (token.startsWith("/") ? token.replace(/[^\n]/g, " ") : token),
  );
  const match = new RegExp(
    `\\b${name}(?:\\s*=\\s*|\\s+)(?:"([^"\\n]*)"|'([^'\\n]*)'|([^\\s;{}"'=]+))`,
  ).exec(source);
  return match === null ? undefined : (match[1] ?? match[2] ?? match[3]);
}

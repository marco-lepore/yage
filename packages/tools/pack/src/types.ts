/** A packaging target. Capacitor's two platforms are separate targets. */
export type Target = "electron" | "ios" | "android";

/** The three targets, in the order the help text and reports list them. */
export const TARGETS: readonly Target[] = Object.freeze([
  "electron",
  "ios",
  "android",
]);

/** The host package each target's game entry imports. */
export const HOST_PACKAGE: Readonly<Record<Target, string>> = Object.freeze({
  electron: "@yagejs/host-electron",
  ios: "@yagejs/host-capacitor",
  android: "@yagejs/host-capacitor",
});

/** One rule's outcome. */
export interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  /** What was found, in one sentence. */
  readonly detail: string;
  /** The exact command or setting that fixes a failure; `null` when `ok`. */
  readonly fix: string | null;
}

/** Every rule one command ran for one target. */
export interface CheckReport {
  readonly command: "doctor" | "check";
  readonly target: Target;
  readonly ok: boolean;
  readonly results: readonly CheckResult[];
}

/** The two sections of a `package.json` a required package can belong in. */
export interface RequiredPackages {
  readonly dependencies: readonly string[];
  readonly devDependencies: readonly string[];
}

/**
 * Packages each target's build needs installed, by the `package.json` section
 * they belong in. The section matters: an Electron package keeps only the
 * production dependencies, and `npx cap sync` installs native code only for
 * the plugins the app's own manifest lists.
 */
export const REQUIRED_PACKAGES: Readonly<Record<Target, RequiredPackages>> =
  Object.freeze({
    electron: {
      dependencies: [HOST_PACKAGE.electron],
      devDependencies: [
        "electron",
        "@electron-forge/cli",
        "@electron-forge/maker-zip",
        "@electron-forge/plugin-fuses",
        "@electron/fuses",
        "@yagejs-tools/pack",
      ],
    },
    ios: {
      dependencies: [
        HOST_PACKAGE.ios,
        "@capacitor/core",
        "@capacitor/app",
        "@capacitor/filesystem",
        "@capacitor/screen-orientation",
        "@capacitor/ios",
      ],
      devDependencies: ["@capacitor/cli", "@yagejs-tools/pack"],
    },
    android: {
      dependencies: [
        HOST_PACKAGE.android,
        "@capacitor/core",
        "@capacitor/app",
        "@capacitor/filesystem",
        "@capacitor/screen-orientation",
        "@capacitor/android",
      ],
      devDependencies: ["@capacitor/cli", "@yagejs-tools/pack"],
    },
  });

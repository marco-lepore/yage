import { afterEach, describe, expect, it } from "vitest";
import { requireCapacitorShell, requirePlugin } from "./shell.js";
import { resetCapacitor, shell } from "./test/fakeCapacitor.js";

afterEach(() => {
  resetCapacitor();
});

describe("requireCapacitorShell", () => {
  it("passes inside an app", () => {
    expect(() =>
      requireCapacitorShell("CapacitorHostPlugin.install", "plugin"),
    ).not.toThrow();
  });

  it("names the build a browser page should leave it out of", () => {
    shell.native = false;
    expect(() =>
      requireCapacitorShell("CapacitorHostPlugin.install", "plugin"),
    ).toThrow(
      "CapacitorHostPlugin.install: this page is not running inside a " +
        "Capacitor app. Leave this plugin out of a browser build.",
    );
    expect(() =>
      requireCapacitorShell("capacitorSaveAdapter", "adapter"),
    ).toThrow(
      "capacitorSaveAdapter: this page is not running inside a Capacitor " +
        "app. Leave this adapter out of a browser build.",
    );
  });
});

describe("requirePlugin", () => {
  it("passes for a plugin the app carries", () => {
    expect(() =>
      requirePlugin("CapacitorHostPlugin.install", "App", "@capacitor/app"),
    ).not.toThrow();
  });

  it("names the package to add and the command that installs it", () => {
    shell.plugins = new Set();
    expect(() =>
      requirePlugin("CapacitorHostPlugin.install", "App", "@capacitor/app"),
    ).toThrow(
      "CapacitorHostPlugin.install: the @capacitor/app plugin is not in " +
        'this app. Add "@capacitor/app" to the app\'s package.json ' +
        "dependencies and run npx cap sync.",
    );
    expect(() =>
      requirePlugin(
        "capacitorSaveAdapter",
        "Filesystem",
        "@capacitor/filesystem",
      ),
    ).toThrow(
      "capacitorSaveAdapter: the @capacitor/filesystem plugin is not in " +
        'this app. Add "@capacitor/filesystem" to the app\'s package.json ' +
        "dependencies and run npx cap sync.",
    );
  });
});

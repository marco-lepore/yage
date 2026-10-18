import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runInit } from "./init.js";
import { addFile, installed, makeTree, snapshot } from "./test/tree.js";

const BOOT = `import type { Plugin } from "@yagejs/core";

export interface BootOptions {
  readonly hostPlugins: readonly Plugin[];
}

export async function boot(options: BootOptions): Promise<void> {
  void options;
}
`;

const manifest = {
  name: "my-game",
  version: "0.1.0",
  dependencies: {},
  devDependencies: { vite: "^8.0.0", typescript: "~5.9.0" },
};

/** A game that `init` accepts, with both host packages installed. */
function game(overrides: Record<string, string> = {}): string {
  return makeTree({
    "package.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "tsconfig.json": "{}\n",
    "src/boot.ts": BOOT,
    ...installed("@yagejs/host-electron"),
    ...installed("@yagejs/host-capacitor"),
    ...overrides,
  });
}

const allTargets = ["electron", "ios", "android"];

function read(root: string, file: string): string {
  return readFileSync(path.join(root, file), "utf8");
}

describe("runInit refusals", () => {
  it("names a directory that is not a game", () => {
    const root = makeTree({});
    expect(() =>
      runInit({ root, targets: ["electron"], force: false }),
    ).toThrow(
      `yage-pack init: no package.json in ${root}. Run this from the game's root directory.`,
    );
  });

  it("names an unknown target", () => {
    const root = game();
    const before = snapshot(root);
    expect(() => runInit({ root, targets: ["macos"], force: false })).toThrow(
      'yage-pack init: --target must be electron, ios or android, got "macos".',
    );
    expect(snapshot(root)).toEqual(before);
  });

  it("asks for the boot module before writing an entry that imports it", () => {
    const root = game({ "src/boot.ts": "export const other = 1;\n" });
    const before = snapshot(root);
    expect(() =>
      runInit({ root, targets: ["electron"], force: false }),
    ).toThrow(
      "yage-pack init: src/boot.ts with an exported boot function is missing.",
    );
    expect(snapshot(root)).toEqual(before);
  });

  it("asks for the host package each entry imports", () => {
    const root = makeTree({
      "package.json": JSON.stringify(manifest),
      "src/boot.ts": BOOT,
    });
    expect(() =>
      runInit({ root, targets: ["ios"], appId: "com.example.a", force: false }),
    ).toThrow(
      "yage-pack init: @yagejs/host-capacitor is not installed. Run npm install @yagejs/host-capacitor first.",
    );
  });

  it("asks for an identifier when the manifest has none", () => {
    const root = game();
    expect(() =>
      runInit({ root, targets: ["electron"], force: false }),
    ).toThrow(
      "yage-pack init: pass --app-id, the app's reverse-domain identifier " +
        "(for example com.example.mygame). It names the save directory and " +
        "must not change after the first release.",
    );
  });

  it("refuses an identifier that differs from the one the saves follow", () => {
    const root = game({
      "package.json": JSON.stringify({
        ...manifest,
        yage: { appId: "com.example.mygame" },
      }),
    });
    expect(() =>
      runInit({
        root,
        targets: ["electron"],
        appId: "com.example.other",
        force: false,
      }),
    ).toThrow(
      'yage-pack init: --app-id com.example.other differs from package.json "yage.appId" com.example.mygame. ' +
        "Changing it moves every player's saves; edit package.json yourself if that is intended.",
    );
  });

  it("refuses an identifier a host would not accept", () => {
    const root = game();
    expect(() =>
      runInit({ root, targets: ["electron"], appId: "mygame", force: false }),
    ).toThrow("yage-pack init: --app-id must match");
  });

  it("asks for a display name when nothing provides one", () => {
    const root = game({ "package.json": JSON.stringify({ version: "1.0.0" }) });
    expect(() =>
      runInit({
        root,
        targets: ["electron"],
        appId: "com.example.mygame",
        force: false,
      }),
    ).toThrow("yage-pack init: pass --name, the app's display name.");
  });

  it("names a path it would write that is a directory", () => {
    const root = game();
    addFile(root, "forge.config.cjs/inner.txt", "x");
    expect(() =>
      runInit({
        root,
        targets: ["electron"],
        appId: "com.example.mygame",
        force: false,
      }),
    ).toThrow(
      `yage-pack init: ${path.join(root, "forge.config.cjs")} is a directory.`,
    );
  });
});

describe("runInit", () => {
  it("writes every file, field and script the targets need", () => {
    const root = game();
    const report = runInit({
      root,
      targets: allTargets,
      appId: "com.example.mygame",
      force: false,
    });
    expect(report.files.map((file) => file.file)).toEqual([
      "src/main.electron.ts",
      "electron/main.cjs",
      "forge.config.cjs",
      "src/main.capacitor.ts",
      "capacitor.config.ts",
    ]);
    expect(report.files.every((file) => file.outcome === "wrote")).toBe(true);

    expect(read(root, "src/main.electron.ts")).toContain(
      'import { ElectronHostPlugin } from "@yagejs/host-electron";',
    );
    expect(read(root, "src/main.capacitor.ts")).toContain(
      'import { CapacitorHostPlugin } from "@yagejs/host-capacitor";',
    );
    expect(read(root, "electron/main.cjs")).toContain(
      'const { startGame } = require("@yagejs/host-electron/main");',
    );
    expect(read(root, "forge.config.cjs")).toBe(
      'const { electronForgeConfig } = require("@yagejs-tools/pack/forge");\n\nmodule.exports = electronForgeConfig();\n',
    );
    expect(read(root, "capacitor.config.ts")).toBe(
      'import { capacitorConfig } from "@yagejs-tools/pack/capacitor";\n\nexport default capacitorConfig();\n',
    );

    const written = JSON.parse(read(root, "package.json")) as {
      productName: string;
      main: string;
      yage: { appId: string };
      scripts: Record<string, string>;
    };
    expect(written.productName).toBe("my-game");
    expect(written.yage.appId).toBe("com.example.mygame");
    expect(written.main).toBe("electron/main.cjs");
    expect(written.scripts).toEqual({
      "build:electron": "tsc --noEmit && vite build --mode electron",
      "start:electron": "npm run build:electron && electron-forge start",
      "package:electron": "npm run build:electron && electron-forge package",
      "make:electron": "npm run build:electron && electron-forge make",
      "build:capacitor": "tsc --noEmit && vite build --mode capacitor",
      "sync:capacitor": "npm run build:capacitor && cap sync",
      "capacitor:sync:after": "npx yage-pack check",
    });
    expect(read(root, ".gitignore")).toBe(
      "dist-electron\nout\ndist-capacitor\n",
    );
    expect(report.nextSteps).toEqual([
      "npm run start:electron",
      "npm run build:capacitor",
      "npx cap add ios --packagemanager SPM",
      "npx cap add android",
      "npx cap open ios",
    ]);
  });

  it("keeps every file and byte on a second run", () => {
    const root = game();
    const options = {
      root,
      targets: allTargets,
      appId: "com.example.mygame",
      force: false,
    };
    runInit(options);
    const after = snapshot(root);
    const report = runInit(options);
    expect(report.files.every((file) => file.outcome === "kept")).toBe(true);
    expect(report.manifest.every((field) => field.outcome === "kept")).toBe(
      true,
    );
    expect(report.ignored).toEqual([]);
    expect(snapshot(root)).toEqual(after);
  });

  it("rewrites the files it owns on force and keeps the scripts the game changed", () => {
    const root = game();
    const options = {
      root,
      targets: allTargets,
      appId: "com.example.mygame",
      force: false,
    };
    runInit(options);
    writeFileSync(path.join(root, "forge.config.cjs"), "// mine\n");
    const manifestFile = path.join(root, "package.json");
    const edited = JSON.parse(readFileSync(manifestFile, "utf8")) as {
      scripts: Record<string, string>;
    };
    edited.scripts["make:electron"] = "npm run build:electron && my-maker";
    writeFileSync(manifestFile, `${JSON.stringify(edited, null, 2)}\n`);

    runInit({ ...options, force: true });
    expect(read(root, "forge.config.cjs")).toContain("electronForgeConfig()");
    expect(
      (
        JSON.parse(read(root, "package.json")) as {
          scripts: Record<string, string>;
        }
      ).scripts["make:electron"],
    ).toBe("npm run build:electron && my-maker");
  });

  it("replaces the display name but never the identifier", () => {
    const root = game({
      "package.json": JSON.stringify({
        ...manifest,
        productName: "Old Name",
        yage: { appId: "com.example.mygame" },
      }),
    });
    runInit({ root, targets: ["electron"], name: "New Name", force: false });
    const written = JSON.parse(read(root, "package.json")) as {
      productName: string;
      yage: { appId: string };
    };
    expect(written.productName).toBe("New Name");
    expect(written.yage.appId).toBe("com.example.mygame");
    expect(read(root, "electron/main.cjs")).toContain("title: productName");
  });

  it("drops the type check from the build when the game has no TypeScript", () => {
    const root = game({
      "package.json": JSON.stringify({
        ...manifest,
        devDependencies: { vite: "^8.0.0" },
      }),
    });
    runInit({
      root,
      targets: allTargets,
      appId: "com.example.mygame",
      force: false,
    });
    const scripts = (
      JSON.parse(read(root, "package.json")) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    expect(scripts["build:electron"]).toBe("vite build --mode electron");
    expect(scripts["build:capacitor"]).toBe("vite build --mode capacitor");
  });

  it("names the directories a game's own build must write", () => {
    const root = game({
      "package.json": JSON.stringify({ ...manifest, devDependencies: {} }),
    });
    const report = runInit({
      root,
      targets: allTargets,
      appId: "com.example.mygame",
      force: false,
    });
    expect(report.notes).toEqual([
      "No build script was written: make your own build write dist-electron/.",
      "No build script was written: make your own build write dist-capacitor/.",
    ]);
    const scripts = (
      JSON.parse(read(root, "package.json")) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    expect(scripts["build:electron"]).toBeUndefined();
    expect(scripts["build:capacitor"]).toBeUndefined();
  });

  it("appends the ignore lines once, to the file the game already has", () => {
    const root = game({ ".gitignore": "node_modules\ndist\n" });
    runInit({
      root,
      targets: ["electron"],
      appId: "com.example.mygame",
      force: false,
    });
    expect(read(root, ".gitignore")).toBe(
      "node_modules\ndist\ndist-electron\nout\n",
    );
  });
});

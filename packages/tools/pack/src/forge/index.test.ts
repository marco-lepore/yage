import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BuildRecord } from "../record.js";
import { installFuseReader, installFusesPlugin, wire } from "../test/fuses.js";
import { addFile, installed, makeTree, removeTrees } from "../test/tree.js";
import { RELEASE_FUSES } from "./index.js";
import { electronForgeConfig } from "./index.js";

const manifest = {
  name: "my-game",
  productName: "My Game",
  version: "1.2.3",
  main: "electron/main.cjs",
  yage: { appId: "com.example.mygame" },
};

/** A game Forge can package, with the two packages the config loads. */
function game(overrides: Record<string, string> = {}): string {
  const root = makeTree({
    "package.json": JSON.stringify(manifest),
    "electron/main.cjs": "// shell\n",
    "dist-electron/index.html": "<!doctype html>\n",
    "src/main.ts": "// game\n",
    "out/old": "",
    ".git/HEAD": "ref: refs/heads/main\n",
    "ios/App/marker": "",
    ...installed("@yagejs/host-electron", {
      version: "0.12.0",
      dependencies: { "@yagejs/save": "^0.12.0" },
    }),
    ...installed("@yagejs/save", {
      version: "0.12.0",
      dependencies: { "@yagejs/core": "^0.12.0" },
    }),
    ...installed("@yagejs/core", { version: "0.12.0" }),
    ...installed("unrelated"),
    ...overrides,
  });
  installFusesPlugin(root);
  installFuseReader(root, wire());
  return root;
}

afterEach(() => {
  removeTrees();
});

describe("electronForgeConfig validation", () => {
  it("refuses a packager setting it owns", () => {
    const root = game();
    for (const key of ["asar", "appBundleId", "ignore"]) {
      expect(() =>
        electronForgeConfig({
          root,
          packagerConfig: { [key]: true } as never,
        }),
      ).toThrow(
        `electronForgeConfig: packagerConfig.${key} is set by @yagejs-tools/pack; remove it.`,
      );
    }
  });

  it("names a manifest that does not point at a shell", () => {
    const root = game({
      "package.json": JSON.stringify({ ...manifest, main: undefined }),
    });
    expect(() => electronForgeConfig({ root })).toThrow(
      'electronForgeConfig: package.json "main" must name the shell\'s main script, got undefined.',
    );
  });

  it("refuses an extra path outside the game", () => {
    const root = game();
    expect(() =>
      electronForgeConfig({ root, include: ["../elsewhere"] }),
    ).toThrow(
      'electronForgeConfig: include[0] must be a path inside the game, got "../elsewhere".',
    );
    expect(() => electronForgeConfig({ root, include: ["/etc"] })).toThrow(
      'electronForgeConfig: include[1] must be a path inside the game, got "/etc".'.replace(
        "[1]",
        "[0]",
      ),
    );
  });

  it("names a package installed at the workspace root, outside the game's folder", () => {
    const workspace = makeTree({
      "package.json": JSON.stringify({ private: true, workspaces: ["game"] }),
      ...installed("@yagejs/host-electron", { version: "0.12.0" }),
    });
    const root = path.join(workspace, "game");
    addFile(workspace, "game/package.json", JSON.stringify(manifest));
    addFile(workspace, "game/electron/main.cjs", "// shell\n");
    mkdirSync(path.join(workspace, "node_modules"), { recursive: true });
    symlinkSync(root, path.join(workspace, "node_modules", "my-game"));
    expect(() => electronForgeConfig({ root })).toThrow(
      `electronForgeConfig: @yagejs/host-electron is installed at ${path.join(workspace, "node_modules", "@yagejs", "host-electron")}, ` +
        `outside the game's node_modules, and an Electron package carries only the game's folder. Run npm install --workspaces=false in ${root}.`,
    );
  });

  it("names a runtime dependency the game has not installed", () => {
    const root = game();
    expect(() =>
      electronForgeConfig({ root, runtimeDependencies: ["sharp"] }),
    ).toThrow(
      "electronForgeConfig: sharp is not installed. Run npm install sharp.",
    );
  });
});

describe("electronForgeConfig result", () => {
  it("sets the archive, the identifier, the makers and the fuses", () => {
    const root = game();
    const config = electronForgeConfig({ root });
    expect(config.packagerConfig?.asar).toBe(true);
    expect(config.packagerConfig?.appBundleId).toBe("com.example.mygame");
    expect(config.makers).toEqual([
      {
        name: "@electron-forge/maker-zip",
        config: {},
        platforms: ["darwin", "win32"],
      },
    ]);
    const fuses = config.plugins?.[0] as unknown as {
      config: Record<string, unknown>;
    };
    expect(fuses.config).toEqual({
      version: "1",
      0: RELEASE_FUSES.RunAsNode,
      1: RELEASE_FUSES.EnableCookieEncryption,
      2: RELEASE_FUSES.EnableNodeOptionsEnvironmentVariable,
      3: RELEASE_FUSES.EnableNodeCliInspectArguments,
      4: RELEASE_FUSES.EnableEmbeddedAsarIntegrityValidation,
      5: RELEASE_FUSES.OnlyLoadAppFromAsar,
      7: RELEASE_FUSES.GrantFileProtocolExtraPrivileges,
    });
  });

  it("keeps the game's packager settings, makers and plugins", () => {
    const root = game();
    const own = { name: "mine" } as never;
    const config = electronForgeConfig({
      root,
      packagerConfig: { icon: "icon.icns" },
      makers: [{ name: "@electron-forge/maker-dmg", config: {} }],
      plugins: [own],
    });
    expect(config.packagerConfig?.icon).toBe("icon.icns");
    expect(config.makers).toHaveLength(1);
    expect(config.plugins?.[1]).toBe(own);
  });

  it("keeps the shell, the web build and the shell's packages in the archive", () => {
    const root = game();
    addFile(root, "assets/credits.txt", "x");
    const config = electronForgeConfig({ root, include: ["assets"] });
    const ignore = config.packagerConfig?.ignore as (file: string) => boolean;
    for (const kept of [
      "",
      "/package.json",
      "/electron",
      "/electron/main.cjs",
      "/dist-electron",
      "/dist-electron/index.html",
      "/assets/credits.txt",
      "/node_modules",
      "/node_modules/@yagejs",
      "/node_modules/@yagejs/host-electron/package.json",
      "/node_modules/@yagejs/save/package.json",
      "/node_modules/@yagejs/core/package.json",
    ]) {
      expect([kept, ignore(kept)]).toEqual([kept, false]);
    }
    for (const dropped of [
      "/src/main.ts",
      "/node_modules/unrelated/index.js",
      "/out/old",
      "/ios/App",
      "/.git/HEAD",
    ]) {
      expect([dropped, ignore(dropped)]).toEqual([dropped, true]);
    }
  });

  it("keeps an include path written with a trailing slash or a dot segment", () => {
    const root = game();
    addFile(root, "assets/credits.txt", "x");
    addFile(root, "data/x/level.json", "{}");
    const config = electronForgeConfig({
      root,
      include: ["assets/", "data/./x"],
    });
    const ignore = config.packagerConfig?.ignore as (file: string) => boolean;
    expect(ignore("/assets/credits.txt")).toBe(false);
    expect(ignore("/data/x/level.json")).toBe(false);
  });
});

describe("electronForgeConfig hooks", () => {
  it("stops a package whose web build is missing", async () => {
    const root = game();
    rmSync(path.join(root, "dist-electron"), { recursive: true });
    const config = electronForgeConfig({ root });
    await expect(
      (config.hooks?.prePackage as (...a: never[]) => Promise<void>)(
        {} as never,
        "darwin" as never,
        "arm64" as never,
      ),
    ).rejects.toThrow("FAIL web build");
  });

  it("writes the record beside the package and adds the make artifacts", async () => {
    const root = game();
    const out = path.join(root, "out", "My Game-darwin-arm64");
    addFile(
      root,
      "out/My Game-darwin-arm64/My Game.app/Contents/Resources/app.asar",
      "x",
    );
    const config = electronForgeConfig({ root });
    await (config.hooks?.postPackage as (...a: never[]) => Promise<void>)(
      { outDir: path.join(root, "out") } as never,
      {
        platform: "darwin",
        arch: "arm64",
        outputPaths: [out],
      } as never,
    );

    const file = path.join(root, "out", "yage-build-electron.json");
    expect(existsSync(file)).toBe(true);
    const record = JSON.parse(readFileSync(file, "utf8")) as BuildRecord;
    expect(record.target).toBe("electron");
    expect(record.profile).toBe("release");
    expect(record.app.appId).toBe("com.example.mygame");
    expect(record.artifacts).toHaveLength(1);

    addFile(root, "out/make/My Game.zip", "zip");
    const results = [
      {
        artifacts: [path.join(root, "out", "make", "My Game.zip")],
        packageJSON: {},
        platform: "darwin",
        arch: "arm64",
      },
    ];
    const returned = await (
      config.hooks?.postMake as (...a: never[]) => Promise<unknown>
    )({} as never, results as never);
    expect(returned).toBe(results);
    const rewritten = JSON.parse(readFileSync(file, "utf8")) as BuildRecord;
    expect(rewritten.artifacts.map((artifact) => artifact.kind)).toEqual([
      "electron-app",
      "electron-zip",
    ]);
  });

  it("checks and records a Windows package by its executable", async () => {
    const root = game();
    const out = path.join(root, "out", "My Game-win32-x64");
    addFile(root, "out/My Game-win32-x64/My Game.exe", "exe");
    addFile(root, "out/My Game-win32-x64/resources/app.asar", "x");
    const config = electronForgeConfig({ root });
    await (config.hooks?.postPackage as (...a: never[]) => Promise<void>)(
      { outDir: path.join(root, "out") } as never,
      { platform: "win32", arch: "x64", outputPaths: [out] } as never,
    );
    const record = JSON.parse(
      readFileSync(path.join(root, "out", "yage-build-electron.json"), "utf8"),
    ) as BuildRecord;
    expect(
      record.artifacts.map((artifact) => [artifact.kind, artifact.path]),
    ).toEqual([["electron-app", out]]);
  });

  it("stops a Linux package with the route to name its executable", async () => {
    const root = game();
    const out = path.join(root, "out", "my-game-linux-x64");
    addFile(root, "out/my-game-linux-x64/my-game", "elf");
    addFile(root, "out/my-game-linux-x64/resources/app.asar", "x");
    const config = electronForgeConfig({ root });
    const error = await (
      config.hooks?.postPackage as (...a: never[]) => Promise<void>
    )(
      { outDir: path.join(root, "out") } as never,
      { platform: "linux", arch: "x64", outputPaths: [out] } as never,
    ).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain(
      "yage-pack check --target electron --release --app <path to the executable>",
    );
    expect(message).not.toContain("Package with electronForgeConfig()");
    expect(existsSync(path.join(root, "out", "yage-build-electron.json"))).toBe(
      false,
    );
  });

  it("records every file the configured makers wrote", async () => {
    const root = game();
    const out = path.join(root, "out", "My Game-darwin-arm64");
    addFile(
      root,
      "out/My Game-darwin-arm64/My Game.app/Contents/Resources/app.asar",
      "x",
    );
    const config = electronForgeConfig({ root });
    await (config.hooks?.postPackage as (...a: never[]) => Promise<void>)(
      { outDir: path.join(root, "out") } as never,
      { platform: "darwin", arch: "arm64", outputPaths: [out] } as never,
    );
    const makers = {
      dmg: ["out/make/My Game-1.2.3-arm64.dmg"],
      squirrel: [
        "out/make/squirrel.windows/x64/RELEASES",
        "out/make/squirrel.windows/x64/My Game-1.2.3 Setup.exe",
        "out/make/squirrel.windows/x64/my_game-1.2.3-full.nupkg",
      ],
      zipWithUpdates: [
        "out/make/zip/darwin/arm64/My Game-darwin-arm64-1.2.3.zip",
        "out/make/zip/darwin/arm64/RELEASES.json",
      ],
    };
    const kinds: Record<string, string[]> = {};
    for (const [maker, files] of Object.entries(makers)) {
      const artifacts = files.map((file) => addFile(root, file, "made\n"));
      await (config.hooks?.postMake as (...a: never[]) => Promise<unknown>)(
        {} as never,
        [
          { artifacts, packageJSON: {}, platform: "darwin", arch: "arm64" },
        ] as never,
      );
      const record = JSON.parse(
        readFileSync(
          path.join(root, "out", "yage-build-electron.json"),
          "utf8",
        ),
      ) as BuildRecord;
      kinds[maker] = record.artifacts.map((artifact) => artifact.kind);
    }
    expect(kinds).toEqual({
      dmg: ["electron-app", "electron-maker-file"],
      squirrel: [
        "electron-app",
        "electron-maker-file",
        "electron-maker-file",
        "electron-maker-file",
      ],
      zipWithUpdates: ["electron-app", "electron-zip", "electron-maker-file"],
    });
  });

  it("runs the game's hook after its own, with what its own returned", async () => {
    const root = game();
    const seen: unknown[] = [];
    const config = electronForgeConfig({
      root,
      hooks: {
        postMake: async (_forgeConfig, makeResults) => {
          seen.push(makeResults);
          return makeResults;
        },
        preStart: async () => {
          seen.push("preStart");
        },
      },
    });
    const results: never[] = [];
    await (config.hooks?.postMake as (...a: never[]) => Promise<unknown>)(
      {} as never,
      results as never,
    );
    await (config.hooks?.preStart as (...a: never[]) => Promise<unknown>)(
      {} as never,
    );
    expect(seen).toEqual([results, "preStart"]);
  });
});

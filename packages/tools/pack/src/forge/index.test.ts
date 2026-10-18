import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { BuildRecord } from "../record.js";
import { installFuseReader, installFusesPlugin, wire } from "../test/fuses.js";
import { addFile, installed, makeTree } from "../test/tree.js";
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

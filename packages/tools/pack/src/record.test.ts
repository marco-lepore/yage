import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashDirectory } from "./hash.js";
import { buildRecord, writeBuildRecord } from "./record.js";
import type { RunResult } from "./run.js";
import { addFile, installed, makeTree, removeTrees } from "./test/tree.js";
import { xcodeProject } from "./test/xcode.js";

const manifest = {
  productName: "My Game",
  version: "1.2.3",
  yage: { appId: "com.example.mygame" },
};

const noGit: (command: string, args: readonly string[]) => RunResult = () => ({
  status: 1,
  stdout: "",
  stderr: "",
});

function game(files: Record<string, string> = {}): string {
  return makeTree({
    "package.json": JSON.stringify(manifest),
    "dist-electron/index.html": "<!doctype html>\n",
    "dist-capacitor/index.html": "<!doctype html>\n",
    ...files,
  });
}

/** A directory artifact with the given inner files. */
function bundle(
  root: string,
  dir: string,
  files: Record<string, string>,
): string {
  for (const [file, body] of Object.entries(files)) {
    addFile(root, path.join(dir, file), body);
  }
  return path.join(root, dir);
}

afterEach(() => {
  vi.unstubAllEnvs();
  removeTrees();
});

describe("buildRecord", () => {
  it("names a packaged Electron app and its archive", async () => {
    const root = game();
    const out = bundle(root, "out/My Game-darwin-arm64", {
      "My Game.app/Contents/Resources/app.asar": "archive\n",
    });
    writeFileSync(path.join(root, "out", "mygame.zip"), "zip\n");
    const record = await buildRecord({
      root,
      target: "electron",
      profile: "release",
      artifacts: [out, path.join(root, "out", "mygame.zip")],
      run: noGit,
    });
    expect(record.artifacts.map((artifact) => artifact.kind)).toEqual([
      "electron-app",
      "electron-zip",
    ]);
    expect(record.artifacts[0]?.path).toBe(path.join(out, "My Game.app"));
    expect(record.artifacts[0]?.isDirectory).toBe(true);
    expect(record.artifacts[0]?.bytes).toBe("archive\n".length);
    expect(record.artifacts[0]?.sha256).toBe(
      (await hashDirectory(path.join(out, "My Game.app"))).digest,
    );
    expect(record.artifacts[1]?.isDirectory).toBe(false);
    expect(record.artifacts[1]?.bytes).toBe("zip\n".length);
  });

  it("records any file an Electron Forge maker wrote", async () => {
    const root = game();
    const files = [
      "out/make/My Game-1.2.3-arm64.dmg",
      "out/make/squirrel.windows/x64/RELEASES",
      "out/make/squirrel.windows/x64/My Game-1.2.3 Setup.exe",
      "out/make/squirrel.windows/x64/my_game-1.2.3-full.nupkg",
    ].map((file) => addFile(root, file, `${path.basename(file)}\n`));
    const record = await buildRecord({
      root,
      target: "electron",
      profile: "release",
      artifacts: files,
      run: noGit,
    });
    expect(
      record.artifacts.map((artifact) => [
        artifact.kind,
        artifact.isDirectory,
        artifact.bytes,
      ]),
    ).toEqual(
      files.map((file) => [
        "electron-maker-file",
        false,
        `${path.basename(file)}\n`.length,
      ]),
    );
    expect(record.artifacts[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses an Electron artifact that is not there", async () => {
    const root = game();
    const dmg = path.join(root, "out", "make", "My Game.dmg");
    await expect(
      buildRecord({
        root,
        target: "electron",
        profile: "release",
        artifacts: [dmg],
        run: noGit,
      }),
    ).rejects.toThrow(
      `record: cannot tell what ${dmg} is for electron. Expected a packaged app directory or a file an Electron Forge maker wrote.`,
    );
  });

  it("tells a simulator build from a device build, an archive and an export", async () => {
    const root = game();
    const simulator = bundle(root, "build/Sim.app", {
      "Info.plist": "<plist>iphonesimulator</plist>",
    });
    const device = bundle(root, "build/Device.app", {
      "Info.plist": "<plist>iphoneos</plist>",
    });
    const archive = bundle(root, "build/My Game.xcarchive", { marker: "" });
    writeFileSync(path.join(root, "build", "MyGame.ipa"), "ipa\n");
    const record = await buildRecord({
      root,
      target: "ios",
      profile: "development",
      artifacts: [
        simulator,
        device,
        archive,
        path.join(root, "build/MyGame.ipa"),
      ],
      run: noGit,
    });
    expect(record.artifacts.map((artifact) => artifact.kind)).toEqual([
      "ios-simulator-app",
      "ios-app",
      "ios-archive",
      "ios-ipa",
    ]);
  });

  it("names an Android package and bundle", async () => {
    const root = game();
    writeFileSync(path.join(root, "app.apk"), "apk\n");
    writeFileSync(path.join(root, "app.aab"), "aab\n");
    const record = await buildRecord({
      root,
      target: "android",
      profile: "release",
      artifacts: [path.join(root, "app.apk"), path.join(root, "app.aab")],
      run: noGit,
    });
    expect(record.artifacts.map((artifact) => artifact.kind)).toEqual([
      "android-apk",
      "android-aab",
    ]);
  });

  it("records the Java runtime a Gradle build starts", async () => {
    const root = game();
    writeFileSync(path.join(root, "app.apk"), "apk\n");
    vi.stubEnv("JAVA_HOME", "/opt/jdk-21");
    const commands: string[] = [];
    const record = await buildRecord({
      root,
      target: "android",
      profile: "release",
      artifacts: [path.join(root, "app.apk")],
      run: (command, args) => {
        commands.push(command);
        return command === "/opt/jdk-21/bin/java" && args[0] === "-version"
          ? { status: 0, stdout: "", stderr: 'openjdk version "21.0.4"\n' }
          : noGit(command, args);
      },
    });
    expect(commands).toContain("/opt/jdk-21/bin/java");
    expect(record.toolchain.java).toBe('openjdk version "21.0.4"');
  });

  it("refuses an artifact the target cannot have produced", async () => {
    const root = game();
    writeFileSync(path.join(root, "notes.txt"), "x\n");
    await expect(
      buildRecord({
        root,
        target: "android",
        profile: "release",
        artifacts: [path.join(root, "notes.txt")],
        run: noGit,
      }),
    ).rejects.toThrow(
      `record: cannot tell what ${path.join(root, "notes.txt")} is for android. Expected an .apk or .aab.`,
    );
  });

  it.runIf(process.platform === "darwin")(
    "reads the signing state from the signature tool",
    async () => {
      const root = game();
      const app = bundle(root, "build/My Game.app", { marker: "" });
      const outputs = [
        "Executable=/x\nSignature=adhoc\n",
        "Executable=/x\nAuthority=Developer ID Application: Someone\n",
        "/x: code object is not signed at all\n",
      ];
      const states = [];
      for (const stderr of outputs) {
        const record = await buildRecord({
          root,
          target: "ios",
          profile: "release",
          artifacts: [app],
          run: (name) =>
            name === "codesign"
              ? { status: 0, stdout: "", stderr }
              : noGit(name, []),
        });
        states.push(record.artifacts[0]?.signed);
      }
      expect(states).toEqual(["ad-hoc", "signed", "unsigned"]);
    },
  );

  it("reads the build number from each platform's project", async () => {
    const ios = game({
      "ios/App/App.xcodeproj/project.pbxproj": xcodeProject({
        release: { CURRENT_PROJECT_VERSION: "7" },
        debug: { CURRENT_PROJECT_VERSION: "6" },
      }),
    });
    // Each profile reads the App target's configuration its build runs with.
    const iosRecords = await Promise.all(
      (["development", "release"] as const).map((profile) =>
        buildRecord({
          root: ios,
          target: "ios",
          profile,
          artifacts: [],
          run: noGit,
        }),
      ),
    );
    expect(iosRecords.map((record) => record.app.build)).toEqual(["6", "7"]);

    const android = game({
      "android/app/build.gradle": "defaultConfig {\n  versionCode 12\n}\n",
    });
    const androidRecord = await buildRecord({
      root: android,
      target: "android",
      profile: "development",
      artifacts: [],
      run: noGit,
    });
    expect(androidRecord.app.build).toBe("12");

    const equals = game({
      "android/app/build.gradle": "defaultConfig {\n  versionCode = 13\n}\n",
    });
    const equalsRecord = await buildRecord({
      root: equals,
      target: "android",
      profile: "development",
      artifacts: [],
      run: noGit,
    });
    expect(equalsRecord.app.build).toBe("13");

    const inherited = game({
      "ios/App/App.xcodeproj/project.pbxproj": xcodeProject({
        release: {},
        projectRelease: { CURRENT_PROJECT_VERSION: "7" },
      }),
    });
    const inheritedRecord = await buildRecord({
      root: inherited,
      target: "ios",
      profile: "release",
      artifacts: [],
      run: noGit,
    });
    expect(inheritedRecord.app.build).toBeNull();
  });

  it("reads the packages of a workspace member from the workspace root", async () => {
    const workspace = makeTree({
      "package.json": JSON.stringify({ private: true, workspaces: ["game"] }),
      "game/package.json": JSON.stringify({ name: "my-game", ...manifest }),
      "game/dist-electron/index.html": "<!doctype html>\n",
      ...installed("@yagejs/core", { version: "0.12.0" }),
      ...installed("@yagejs/save", { version: "0.12.0" }),
      ...installed("pixi.js", { version: "8.22.0" }),
      "game/node_modules/@yagejs/core/package.json": JSON.stringify({
        name: "@yagejs/core",
        version: "0.12.1",
      }),
    });
    const root = path.join(workspace, "game");
    const options = {
      root,
      target: "electron" as const,
      profile: "release" as const,
      artifacts: [],
      run: noGit,
    };
    const outside = await buildRecord(options);
    expect(outside.packages).toEqual({ "@yagejs/core": "0.12.1" });
    expect(outside.dependencies).toEqual({});

    // npm links each workspace member into the workspace root's node_modules.
    symlinkSync(root, path.join(workspace, "node_modules", "my-game"));
    const member = await buildRecord(options);
    expect(member.packages).toEqual({
      "@yagejs/core": "0.12.1",
      "@yagejs/save": "0.12.0",
    });
    expect(member.dependencies).toEqual({ "pixi.js": "8.22.0" });
  });

  it("leaves the source fields empty outside a repository", async () => {
    const record = await buildRecord({
      root: game(),
      target: "electron",
      profile: "release",
      artifacts: [],
      run: noGit,
    });
    expect(record.source).toEqual({ commit: null, dirty: null });
  });

  it("records the commit and the files that differ from it", async () => {
    const record = await buildRecord({
      root: game(),
      target: "electron",
      profile: "release",
      artifacts: [],
      run: (_command, args) =>
        args[0] === "rev-parse"
          ? { status: 0, stdout: "abc123\n", stderr: "" }
          : { status: 0, stdout: " M src/boot.ts\n", stderr: "" },
    });
    expect(record.source).toEqual({
      commit: "abc123",
      dirty: [" M src/boot.ts"],
    });
  });

  it("reads the bridge protocol from the game's own host package", async () => {
    const root = game();
    const host = fileURLToPath(
      new URL("../../../host-electron", import.meta.url),
    );
    mkdirSync(path.join(root, "node_modules", "@yagejs"), { recursive: true });
    symlinkSync(
      host,
      path.join(root, "node_modules", "@yagejs", "host-electron"),
    );
    const record = await buildRecord({
      root,
      target: "electron",
      profile: "release",
      artifacts: [],
      run: noGit,
    });
    expect(record.hostBridgeProtocol).toBe(1);
    expect(record.packages["@yagejs/host-electron"]).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("hashes the web build the target ships", async () => {
    const root = game();
    const record = await buildRecord({
      root,
      target: "electron",
      profile: "release",
      artifacts: [],
      run: noGit,
    });
    expect(record.web.dir).toBe("dist-electron");
    expect(record.web.files.map((file) => file.path)).toEqual(["index.html"]);
    expect(record.web.digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("writeBuildRecord", () => {
  it("replaces a record it wrote before", async () => {
    const root = game();
    const out = path.join(root, "out", "yage-build-electron.json");
    mkdirSync(path.dirname(out), { recursive: true });
    const options = {
      root,
      target: "electron" as const,
      profile: "release" as const,
      artifacts: [],
      run: noGit,
      out,
    };
    await writeBuildRecord(options);
    const first = readFileSync(out, "utf8");
    expect(JSON.parse(first)).toMatchObject({ schema: 1, target: "electron" });
    await writeBuildRecord(options);
    expect(JSON.parse(readFileSync(out, "utf8"))).toMatchObject({ schema: 1 });
  });

  it("creates the output's directory when it is missing", async () => {
    const root = game();
    const out = path.join(root, "out", "yage-build-ios.json");
    const { file } = await writeBuildRecord({
      root,
      target: "ios",
      profile: "development",
      artifacts: [],
      run: noGit,
      out,
    });
    expect(file).toBe(out);
    expect(JSON.parse(readFileSync(out, "utf8"))).toMatchObject({
      schema: 1,
      target: "ios",
    });
  });

  it("refuses an output that is not a record, and leaves it alone", async () => {
    const root = game();
    const out = path.join(root, "keep.json");
    writeFileSync(out, '{"important":true}\n');
    await expect(
      writeBuildRecord({
        root,
        target: "electron",
        profile: "release",
        artifacts: [],
        run: noGit,
        out,
      }),
    ).rejects.toThrow(
      `record: ${out} exists and is not a build record. Choose another --out.`,
    );
    expect(readFileSync(out, "utf8")).toBe('{"important":true}\n');
  });

  it("refuses an output that is not JSON", async () => {
    const root = game();
    await expect(
      writeBuildRecord({
        root,
        target: "electron",
        profile: "release",
        artifacts: [],
        run: noGit,
        out: path.join(root, "record.txt"),
      }),
    ).rejects.toThrow("record: --out must end in .json");
  });
});

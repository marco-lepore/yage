import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BuildRecord } from "../record.js";
import { installFuseReader, wire } from "../test/fuses.js";
import { addFile, installed, makeTree, removeTrees } from "../test/tree.js";
import type { CheckReport } from "../types.js";
import { runCli } from "./run.js";

const manifest = {
  name: "my-game",
  productName: "My Game",
  version: "1.2.3",
  yage: { appId: "com.example.mygame" },
  dependencies: { "@yagejs/host-electron": "*" },
};

function game(overrides: Record<string, string> = {}): string {
  return makeTree({
    "package.json": JSON.stringify(manifest),
    "dist-electron/index.html": "<!doctype html>\n",
    ...installed("@yagejs/host-electron", {
      version: "0.12.0",
      peerDependencies: { electron: "^44.7.0" },
    }),
    ...overrides,
  });
}

/** Run one command and collect what it printed. */
async function cli(
  argv: readonly string[],
  cwd: string,
): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(
    argv,
    "0.1.0",
    { out: (text) => out.push(text), err: (text) => err.push(text) },
    cwd,
  );
  return { code, out: out.join("\n"), err: err.join("\n") };
}

afterEach(() => {
  removeTrees();
});

describe("runCli", () => {
  it("prints the help and the version", async () => {
    const help = await cli(["--help"], game());
    expect(help.code).toBe(0);
    expect(help.out).toContain("yage-pack init --target");
    expect((await cli(["--version"], game())).out).toBe("0.1.0");
  });

  it("reports a parse failure as an authored error", async () => {
    const result = await cli(["doctor", "--release"], game());
    expect(result.code).toBe(1);
    expect(result.err).toBe(
      "yage-pack: --release is not an option of `yage-pack doctor`.",
    );
  });

  it("exits 1 when a rule fails and prints the fix under it", async () => {
    const root = makeTree({
      "package.json": JSON.stringify(manifest),
      ...installed("@yagejs/host-electron", { version: "0.12.0" }),
    });
    const result = await cli(["check", "--target", "electron"], root);
    expect(result.code).toBe(1);
    expect(result.out).toContain("yage-pack check — electron");
    expect(result.out).toContain("FAIL web build");
    expect(result.out).toContain(
      "  Fix: Build it first: npm run build:electron.",
    );
  });

  it("prints one report as JSON", async () => {
    const root = game();
    installFuseReader(root, wire());
    const result = await cli(["check", "--target", "electron", "--json"], root);
    const report = JSON.parse(result.out) as CheckReport;
    expect(report.command).toBe("check");
    expect(report.target).toBe("electron");
    expect(report.ok).toBe(true);
    expect(result.code).toBe(0);
  });

  it("prints the doctor reports and exits 1 on a failure", async () => {
    const result = await cli(
      ["doctor", "--target", "electron", "--json"],
      game(),
    );
    const reports = JSON.parse(result.out) as CheckReport[];
    expect(reports).toHaveLength(1);
    expect(reports[0]?.target).toBe("electron");
    expect(reports[0]?.ok).toBe(false);
    expect(result.code).toBe(1);
  });

  it("names a target it does not know", async () => {
    const result = await cli(["doctor", "--target", "macos"], game());
    expect(result.code).toBe(1);
    expect(result.err).toBe(
      'yage-pack: --target must be electron, ios or android, got "macos".',
    );
  });

  it("refuses a second target for a command that runs for one", async () => {
    const check = await cli(
      ["check", "--release", "--target", "ios", "--target", "android"],
      game(),
    );
    expect(check.code).toBe(1);
    expect(check.err).toBe(
      "yage-pack: yage-pack check: pass one --target, got 2 (ios, android). " +
        "Run the command once per target.",
    );

    const record = await cli(
      [
        "record",
        "--target",
        "ios",
        "--target",
        "electron",
        "--profile",
        "release",
        "--artifact",
        "x",
      ],
      game(),
    );
    expect(record.code).toBe(1);
    expect(record.err).toBe(
      "yage-pack: yage-pack record: pass one --target, got 2 (ios, electron). " +
        "Run the command once per target.",
    );
  });

  it("refuses --app outside the Electron target", async () => {
    const result = await cli(
      ["check", "--target", "ios", "--app", "out/My Game.app"],
      game(),
    );
    expect(result.code).toBe(1);
    expect(result.err).toBe(
      "yage-pack: yage-pack check: --app reads a packaged Electron app, got --target ios.",
    );
  });

  it("writes a build record where the target's default puts it", async () => {
    const root = game();
    addFile(
      root,
      "out/My Game-darwin-arm64/My Game.app/Contents/Resources/app.asar",
      "x",
    );
    const result = await cli(
      [
        "record",
        "--target",
        "electron",
        "--profile",
        "release",
        "--artifact",
        "out/My Game-darwin-arm64",
      ],
      root,
    );
    expect(result.code).toBe(0);
    const file = path.join(root, "out", "yage-build-electron.json");
    expect(existsSync(file)).toBe(true);
    expect(result.out).toBe(`wrote ${file}`);
    const record = JSON.parse(readFileSync(file, "utf8")) as BuildRecord;
    expect(record.artifacts[0]?.kind).toBe("electron-app");
  });

  it("asks for what a record cannot be written without", async () => {
    const root = game();
    expect((await cli(["record", "--profile", "release"], root)).err).toBe(
      "yage-pack: yage-pack record: pass --target electron, ios or android.",
    );
    expect((await cli(["record", "--target", "electron"], root)).err).toBe(
      "yage-pack: yage-pack record: --profile must be development or release, got undefined.",
    );
    expect(
      (
        await cli(
          ["record", "--target", "electron", "--profile", "release"],
          root,
        )
      ).err,
    ).toBe(
      "yage-pack: yage-pack record: pass --artifact with the path of a file or bundle the build produced.",
    );
  });

  it("runs init and prints what it wrote", async () => {
    const root = game({
      "src/boot.ts": "export async function boot(): Promise<void> {}\n",
    });
    const result = await cli(["init", "--target", "electron"], root);
    expect(result.code).toBe(0);
    expect(result.out).toContain("wrote forge.config.cjs");
    expect(result.out).toContain("npm run start:electron");
  });
});

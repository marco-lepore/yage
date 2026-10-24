import { describe, expect, it } from "vitest";
import { parseArgv } from "./argv.js";

describe("parseArgv", () => {
  it("reads every flag of init", () => {
    const args = parseArgv([
      "init",
      "--target",
      "electron",
      "--target",
      "ios",
      "--app-id",
      "com.example.mygame",
      "--name",
      "My Game",
      "--force",
    ]);
    expect(args).toMatchObject({
      command: "init",
      targets: ["electron", "ios"],
      appId: "com.example.mygame",
      name: "My Game",
      force: true,
    });
    expect(args.error).toBeUndefined();
  });

  it("reads every flag of check and record", () => {
    expect(
      parseArgv([
        "check",
        "--target",
        "ios",
        "--release",
        "--app",
        "out/a.app",
        "--previous",
        "last.json",
        "--json",
      ]),
    ).toMatchObject({
      command: "check",
      targets: ["ios"],
      release: true,
      apps: ["out/a.app"],
      previous: "last.json",
      json: true,
    });
    expect(
      parseArgv([
        "record",
        "--target",
        "android",
        "--profile",
        "release",
        "--artifact",
        "app.apk",
        "--out",
        "record.json",
      ]),
    ).toMatchObject({
      command: "record",
      profile: "release",
      artifacts: ["app.apk"],
      out: "record.json",
    });
  });

  it("names an unknown flag", () => {
    expect(parseArgv(["doctor", "--verbose"]).error).toContain("--verbose");
  });

  it("names a flag that belongs to another command", () => {
    expect(parseArgv(["doctor", "--release"]).error).toBe(
      "--release is not an option of `yage-pack doctor`.",
    );
  });

  it("names an unknown command and an extra argument", () => {
    expect(parseArgv(["build"]).error).toBe(
      'Unknown command "build". Expected init, doctor, check or record.',
    );
    expect(parseArgv(["doctor", "extra"]).error).toBe(
      'Unexpected argument "extra".',
    );
  });

  it("asks for a command when there is none", () => {
    expect(parseArgv([]).error).toBe(
      "Pass a command: init, doctor, check or record.",
    );
    expect(parseArgv(["--help"]).error).toBeUndefined();
    expect(parseArgv(["-v"]).version).toBe(true);
  });
});

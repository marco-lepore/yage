import { describe, expect, it } from "vitest";
import { parseArgs } from "./argv.js";

describe("parseArgs", () => {
  it("runs the editor with no arguments", () => {
    const parsed = parseArgs([]);

    expect(parsed.command).toBe("dev");
    expect(parsed.error).toBeUndefined();
  });

  it("accepts the dev command spelled out", () => {
    expect(parseArgs(["dev"])).toMatchObject({ command: "dev" });
  });

  it("reads the init command and its flag", () => {
    expect(parseArgs(["init"])).toMatchObject({ command: "init" });
    expect(parseArgs(["init", "--force"])).toMatchObject({
      command: "init",
      force: true,
    });
  });

  it.each([
    [["--port", "3000"], { port: 3000 }],
    [["--port=3000"], { port: 3000 }],
    [["--no-open"], { open: false }],
    [["--config", "tools/editor.ts"], { config: "tools/editor.ts" }],
    [["--config=tools/editor.ts"], { config: "tools/editor.ts" }],
    [["-h"], { help: true }],
    [["--version"], { version: true }],
  ])("reads %s", (argv, expected) => {
    expect(parseArgs(argv)).toMatchObject(expected);
  });

  it.each([
    ["an unknown option", ["--scenarios", "a"]],
    ["an unknown command", ["validate"]],
    ["a port that is not a number", ["--port", "http"]],
    ["a port outside the range", ["--port", "70000"]],
    ["a flag with no value", ["--config"]],
    ["a flag with an empty value", ["--config="]],
    ["a second command word", ["init", "dev"]],
    ["a dev option passed to init", ["init", "--port", "3000"]],
    ["--force passed to dev", ["--force"]],
  ])("refuses %s rather than falling back to a default", (_name, argv) => {
    expect(parseArgs(argv).error).toBeTruthy();
  });

  it("names the command a user is likely to have meant", () => {
    expect(parseArgs(["start"]).error).toContain("yage-editor");
  });
});

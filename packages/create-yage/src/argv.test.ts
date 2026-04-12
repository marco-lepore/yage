import { describe, expect, it } from "vitest";
import { parseArgs } from "./argv.js";

describe("parseArgs", () => {
  it("parses no arguments", () => {
    expect(parseArgs([])).toEqual({ help: false, version: false });
  });

  it("parses a positional target directory", () => {
    expect(parseArgs(["my-game"])).toEqual({
      help: false,
      version: false,
      targetDir: "my-game",
    });
  });

  it("parses --template with space-separated value", () => {
    const result = parseArgs(["--template", "minimal"]);
    expect(result.template).toBe("minimal");
    expect(result.error).toBeUndefined();
  });

  it("parses --template with equals syntax", () => {
    expect(parseArgs(["--template=recommended"]).template).toBe("recommended");
  });

  it("rejects unknown templates", () => {
    const result = parseArgs(["--template", "unknown"]);
    expect(result.error).toContain("Unknown template");
  });

  it("rejects --template without value", () => {
    const result = parseArgs(["--template"]);
    expect(result.error).toContain("requires a value");
  });

  it("parses --no-install / --no-git flags", () => {
    const result = parseArgs(["--no-install", "--no-git"]);
    expect(result.install).toBe(false);
    expect(result.git).toBe(false);
  });

  it("parses --force and --yes", () => {
    const result = parseArgs(["--force", "--yes"]);
    expect(result.overwrite).toBe(true);
    expect(result.yes).toBe(true);
  });

  it("parses -f and -y short flags", () => {
    const result = parseArgs(["-f", "-y"]);
    expect(result.overwrite).toBe(true);
    expect(result.yes).toBe(true);
  });

  it("parses --help and --version", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
    expect(parseArgs(["--version"]).version).toBe(true);
    expect(parseArgs(["-v"]).version).toBe(true);
  });

  it("combines positional and flags", () => {
    const result = parseArgs(["my-game", "--template", "minimal", "--yes"]);
    expect(result.targetDir).toBe("my-game");
    expect(result.template).toBe("minimal");
    expect(result.yes).toBe(true);
  });

  it("rejects unknown flags", () => {
    expect(parseArgs(["--nope"]).error).toContain("Unknown flag");
  });

  it("rejects a second positional argument", () => {
    const result = parseArgs(["first", "second"]);
    expect(result.error).toContain("Unexpected argument: second");
  });
});

import { describe, expect, it } from "vitest";
import { parseArgs } from "./argv.js";

describe("parseArgs", () => {
  it("defaults to dev", () => {
    expect(parseArgs([])).toMatchObject({ command: "dev", help: false });
  });

  it("takes the command", () => {
    expect(parseArgs(["build"]).command).toBe("build");
    expect(parseArgs(["dev"]).command).toBe("dev");
    expect(parseArgs(["init"]).command).toBe("init");
    expect(parseArgs(["test"]).command).toBe("test");
  });

  it("takes --force on init", () => {
    expect(parseArgs(["init", "--force"]).force).toBe(true);
    expect(parseArgs(["init"]).force).toBeUndefined();
  });

  it("reads a port in both forms", () => {
    expect(parseArgs(["--port", "6000"]).port).toBe(6000);
    expect(parseArgs(["--port=6000"]).port).toBe(6000);
    expect(parseArgs(["-p", "6000"]).port).toBe(6000);
  });

  it("rejects a port that is not one", () => {
    expect(parseArgs(["--port", "http"]).error).toMatch(/Invalid port/);
    expect(parseArgs(["--port", "99999"]).error).toMatch(/Invalid port/);
    expect(parseArgs(["--port"]).error).toMatch(/requires a value/);
  });

  it("splits a scenario list", () => {
    expect(
      parseArgs(["--scenarios", "src/**/*.scenario.ts, ui/*.scenario.ts"]),
    ).toMatchObject({
      scenarios: ["src/**/*.scenario.ts", "ui/*.scenario.ts"],
    });
  });

  it("reads the build output directory", () => {
    expect(parseArgs(["build", "--out-dir", "site"]).outDir).toBe("site");
    expect(parseArgs(["build", "--out-dir=site"]).outDir).toBe("site");
  });

  it("rejects a path flag given nothing to use", () => {
    // An empty value names the Vite root, which is the project itself.
    expect(parseArgs(["build", "--out-dir="]).error).toMatch(
      /requires a value/,
    );
    expect(parseArgs(["test", "--screenshots="]).error).toMatch(
      /requires a value/,
    );
  });

  it("reads a test timeout in both forms", () => {
    expect(parseArgs(["test", "--timeout", "5000"]).timeout).toBe(5000);
    expect(parseArgs(["test", "--timeout=5000"]).timeout).toBe(5000);
  });

  it("rejects a timeout that is not one", () => {
    expect(parseArgs(["test", "--timeout", "soon"]).error).toMatch(
      /Invalid timeout/,
    );
    expect(parseArgs(["test", "--timeout", "0"]).error).toMatch(
      /Invalid timeout/,
    );
    expect(parseArgs(["test", "--timeout"]).error).toMatch(/requires a value/);
  });

  it("reads the screenshot directory", () => {
    expect(parseArgs(["test", "--screenshots", "shots"]).screenshots).toBe(
      "shots",
    );
    expect(parseArgs(["test", "--screenshots=shots"]).screenshots).toBe(
      "shots",
    );
    expect(parseArgs(["test"]).screenshots).toBeUndefined();
  });

  it("takes --no-open", () => {
    expect(parseArgs(["--no-open"]).open).toBe(false);
    expect(parseArgs([]).open).toBeUndefined();
  });

  it("rejects a flag the command does not have", () => {
    expect(parseArgs(["build", "--port", "6000"]).error).toMatch(
      /not an option/,
    );
    expect(parseArgs(["build", "--no-open"]).error).toMatch(/not an option/);
    expect(parseArgs(["dev", "--out-dir", "site"]).error).toMatch(
      /not an option/,
    );
    expect(parseArgs(["dev", "--force"]).error).toMatch(/not an option/);
    expect(parseArgs(["init", "--port", "6000"]).error).toMatch(
      /not an option/,
    );
    expect(parseArgs(["init", "--scenarios", "a"]).error).toMatch(
      /not an option/,
    );
    expect(parseArgs(["test", "--port", "6000"]).error).toMatch(
      /not an option/,
    );
    expect(parseArgs(["dev", "--timeout", "5000"]).error).toMatch(
      /not an option/,
    );
    expect(parseArgs(["build", "--screenshots", "shots"]).error).toMatch(
      /not an option/,
    );
  });

  it("rejects what it does not know, so a typo does not run the defaults", () => {
    expect(parseArgs(["--prot", "6000"]).error).toMatch(/Unknown flag/);
    expect(parseArgs(["serve"]).error).toMatch(/Unknown command/);
    expect(parseArgs(["dev", "build"]).error).toMatch(/Unexpected argument/);
  });

  it("takes help and version anywhere", () => {
    expect(parseArgs(["build", "--help"]).help).toBe(true);
    expect(parseArgs(["-v"]).version).toBe(true);
  });
});

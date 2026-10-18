import { afterEach, describe, expect, it } from "vitest";
import { capacitorSaveAdapter } from "./saves.js";
import { files, resetCapacitor, shell } from "./test/fakeCapacitor.js";

afterEach(() => {
  resetCapacitor();
});

describe("capacitorSaveAdapter", () => {
  it("refuses a browser page before it asks for a plugin", () => {
    shell.native = false;
    shell.plugins = new Set();
    expect(() => capacitorSaveAdapter({ profile: "test" })).toThrow(
      "capacitorSaveAdapter: this page is not running inside a Capacitor " +
        "app. Leave this adapter out of a browser build.",
    );
  });

  it("refuses an app without the Filesystem plugin before it reads the profile", () => {
    shell.plugins = new Set(["App"]);
    expect(() => capacitorSaveAdapter({ profile: "Release" })).toThrow(
      "capacitorSaveAdapter: the @capacitor/filesystem plugin is not in " +
        'this app. Add "@capacitor/filesystem" to the app\'s package.json ' +
        "dependencies and run npx cap sync.",
    );
  });

  it("states what a profile may be called", () => {
    expect(() => capacitorSaveAdapter({ profile: "Release" })).toThrow(
      'capacitorSaveAdapter: profile must match ^[a-z][a-z0-9-]*$, got "Release".',
    );
  });

  it("keeps one profile's saves in its own directory", async () => {
    const adapter = capacitorSaveAdapter({ profile: "test" });
    await adapter.write("slot-1", "the save");
    expect(await adapter.read("slot-1")).toBe("the save");
    expect(await adapter.list("")).toEqual(["slot-1"]);

    const written = [...files.content.keys()];
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/^yage-saves\/test\/k-[a-z2-7]+\.sav$/);

    await adapter.delete("slot-1");
    expect(await adapter.read("slot-1")).toBeNull();
    expect([...files.content.keys()]).toEqual([]);
  });

  it("keeps the two build profiles apart", async () => {
    const test = capacitorSaveAdapter({ profile: "test" });
    const release = capacitorSaveAdapter({ profile: "release" });
    await test.write("slot-1", "from the test build");
    expect(await release.read("slot-1")).toBeNull();
    expect([...files.directories]).toEqual(["yage-saves/test"]);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { app, resetFakeElectron } from "../test/fakeElectron.js";
import { saveDirectory } from "./saveDirectory.js";

beforeEach(() => {
  resetFakeElectron();
});

describe("saveDirectory", () => {
  it("puts one profile's saves under the app's own identifier", () => {
    expect(saveDirectory({ appId: "dev.yage.baseline", profile: "test" })).toBe(
      "/fake/appData/dev.yage.baseline/saves/test",
    );
  });

  it("follows the system's application-data directory", () => {
    app.paths = { appData: "/elsewhere/AppData" };
    expect(saveDirectory({ appId: "Game", profile: "release" })).toBe(
      "/elsewhere/AppData/Game/saves/release",
    );
  });

  it("refuses an identifier or profile a directory name cannot hold", () => {
    expect(() => saveDirectory({ appId: "-x", profile: "test" })).toThrowError(
      'saveDirectory: appId must match ^[A-Za-z0-9][A-Za-z0-9.-]*$, got "-x".',
    );
    expect(() =>
      saveDirectory({ appId: "dev.yage", profile: "Release" }),
    ).toThrowError(
      'saveDirectory: profile must match ^[a-z][a-z0-9-]*$, got "Release".',
    );
  });
});

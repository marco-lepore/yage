import { afterEach, describe, expect, it } from "vitest";
import { makeTree } from "../test/tree.js";
import { capacitorConfig } from "./index.js";

const manifest = {
  productName: "My Game",
  version: "1.2.3",
  yage: { appId: "com.example.mygame" },
};

const original = process.cwd();

function inGame(overrides: Record<string, unknown> = manifest): string {
  const root = makeTree({ "package.json": JSON.stringify(overrides) });
  process.chdir(root);
  return root;
}

afterEach(() => {
  process.chdir(original);
});

describe("capacitorConfig", () => {
  it("fills the identity and the settings the adapter depends on", () => {
    inGame();
    expect(capacitorConfig()).toEqual({
      appId: "com.example.mygame",
      appName: "My Game",
      webDir: "dist-capacitor",
      ios: { contentInset: "never" },
    });
  });

  it("passes every other setting through", () => {
    inGame();
    const config = capacitorConfig({
      android: { allowMixedContent: false },
      ios: { limitsNavigationsToAppBoundDomains: true },
      plugins: { Keyboard: { resize: "none" } },
    });
    expect(config.android).toEqual({ allowMixedContent: false });
    expect(config.ios).toEqual({
      limitsNavigationsToAppBoundDomains: true,
      contentInset: "never",
    });
    expect(config.plugins).toEqual({ Keyboard: { resize: "none" } });
  });

  it("reads the manifest of the directory the command runs in", () => {
    inGame({
      ...manifest,
      productName: "Other",
      yage: { appId: "com.other.x" },
    });
    expect(capacitorConfig().appId).toBe("com.other.x");
  });

  it("refuses an override of a setting it owns", () => {
    inGame();
    expect(() => capacitorConfig({ appId: "com.other.x" })).toThrow(
      "capacitorConfig: appId comes from package.json and the dist-capacitor convention; remove it from the overrides.",
    );
    expect(() => capacitorConfig({ appName: "Other" })).toThrow(
      "capacitorConfig: appName comes from package.json and the dist-capacitor convention; remove it from the overrides.",
    );
    expect(() => capacitorConfig({ webDir: "www" })).toThrow(
      "capacitorConfig: webDir comes from package.json and the dist-capacitor convention; remove it from the overrides.",
    );
  });

  it("refuses a content inset other than never", () => {
    inGame();
    expect(() =>
      capacitorConfig({ ios: { contentInset: "automatic" } }),
    ).toThrow(
      'capacitorConfig: ios.contentInset must stay "never": the page\'s CSS pads for the safe areas, got "automatic".',
    );
  });

  it("refuses taking the Back button away from the game", () => {
    inGame();
    expect(() =>
      capacitorConfig({ plugins: { App: { disableBackButtonHandler: true } } }),
    ).toThrow(
      "capacitorConfig: plugins.App.disableBackButtonHandler must stay unset: with it the Back button never reaches the game.",
    );
  });
});

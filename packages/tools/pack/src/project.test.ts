import { afterEach, describe, expect, it } from "vitest";
import { APP_ID_PATTERN, readIdentity, satisfiesCaret } from "./project.js";
import { makeTree, removeTrees } from "./test/tree.js";

function tree(manifest: unknown): string {
  return makeTree({ "package.json": JSON.stringify(manifest) });
}

afterEach(() => {
  removeTrees();
});

describe("readIdentity", () => {
  it("returns the name, version and identifier the hosts share", () => {
    const root = tree({
      productName: "My Game",
      version: "1.2.3",
      yage: { appId: "com.example.mygame" },
    });
    expect(readIdentity(root, "check")).toEqual({
      appId: "com.example.mygame",
      name: "My Game",
      version: "1.2.3",
    });
  });

  it("names the missing manifest", () => {
    const root = makeTree({});
    expect(() => readIdentity(root, "check")).toThrow(
      `check: no package.json in ${root}. Run this from the game's root directory.`,
    );
  });

  it("names a missing display name before anything else", () => {
    const root = tree({ version: "1.0.0", yage: { appId: "com.example.a" } });
    expect(() => readIdentity(root, "check")).toThrow(
      'check: package.json must set "productName" to the app\'s name, got undefined.',
    );
  });

  it("names an identifier the hosts would not both accept", () => {
    const root = tree({
      productName: "A",
      version: "1.0.0",
      yage: { appId: "com.ex-ample.a" },
    });
    expect(() => readIdentity(root, "check")).toThrow(
      `check: package.json "yage.appId" must match ${APP_ID_PATTERN.source}, got "com.ex-ample.a".`,
    );
  });

  it("names a missing version last", () => {
    const root = tree({ productName: "A", yage: { appId: "com.example.a" } });
    expect(() => readIdentity(root, "check")).toThrow(
      'check: package.json must set "version", got undefined.',
    );
  });
});

describe("APP_ID_PATTERN", () => {
  it("accepts the identifiers both hosts take", () => {
    expect(APP_ID_PATTERN.test("com.example.game")).toBe(true);
    expect(APP_ID_PATTERN.test("a.b1")).toBe(true);
  });

  it("refuses a single part, an underscore, a hyphen and a leading digit", () => {
    expect(APP_ID_PATTERN.test("game")).toBe(false);
    expect(APP_ID_PATTERN.test("com.ex_ample.game")).toBe(false);
    expect(APP_ID_PATTERN.test("com.ex-ample.game")).toBe(false);
    expect(APP_ID_PATTERN.test("1com.example")).toBe(false);
  });
});

describe("satisfiesCaret", () => {
  it("keeps the leftmost non-zero part", () => {
    expect(satisfiesCaret("44.7.0", "^44.7.0")).toBe(true);
    expect(satisfiesCaret("44.9.1", "^44.7.0")).toBe(true);
    expect(satisfiesCaret("45.0.0", "^44.7.0")).toBe(false);
    expect(satisfiesCaret("44.6.9", "^44.7.0")).toBe(false);
    expect(satisfiesCaret("0.12.9", "^0.12.0")).toBe(true);
    expect(satisfiesCaret("0.13.0", "^0.12.0")).toBe(false);
    expect(satisfiesCaret("0.0.4", "^0.0.3")).toBe(false);
  });

  it("refuses a range written any other way", () => {
    expect(() => satisfiesCaret("1.0.0", ">=1.0.0")).toThrow(
      'satisfiesCaret: range must be written ^X.Y.Z, got ">=1.0.0".',
    );
  });
});

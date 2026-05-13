import { describe, expect, it } from "vitest";
import { FEATURES, isFeatureId, parseFeatureList } from "./features.js";
import {
  applyFeaturesToPackageJson,
  applyFeaturesToTsConfig,
} from "./scaffold.js";

describe("feature registry", () => {
  it("knows the documented feature ids", () => {
    expect(isFeatureId("ui")).toBe(true);
    expect(isFeatureId("save")).toBe(true);
    expect(isFeatureId("effects")).toBe(true);
    expect(isFeatureId("xyz")).toBe(false);
  });

  it("declares package deps for each feature", () => {
    expect(FEATURES.ui.dependencies).toHaveProperty("@yagejs/ui");
    expect(FEATURES.ui.dependencies).toHaveProperty("@yagejs/ui-react");
    expect(FEATURES.ui.dependencies).toHaveProperty("react");
    expect(FEATURES.ui.dependencies).toHaveProperty("react-dom");
    expect(FEATURES.ui.devDependencies).toHaveProperty("@types/react");
    expect(FEATURES.ui.tsconfigOptions).toEqual({ jsx: "react-jsx" });

    expect(FEATURES.save.dependencies).toEqual({ "@yagejs/save": "^0.6.0" });
    expect(FEATURES.effects.dependencies).toEqual({
      "@yagejs/effects": "^0.6.0",
    });
  });
});

describe("parseFeatureList", () => {
  it("returns the parsed ids in input order", () => {
    expect(parseFeatureList("save,effects,ui")).toEqual({
      features: ["save", "effects", "ui"],
    });
  });

  it("ignores empty segments and whitespace", () => {
    expect(parseFeatureList("ui, ,save,")).toEqual({
      features: ["ui", "save"],
    });
  });

  it("dedupes", () => {
    expect(parseFeatureList("ui,save,ui")).toEqual({
      features: ["ui", "save"],
    });
  });

  it("reports unknown features", () => {
    const result = parseFeatureList("ui,nope");
    expect("error" in result && result.error).toContain("Unknown feature");
  });
});

describe("applyFeaturesToPackageJson", () => {
  it("returns the input unchanged when no features are requested", () => {
    const pkg = {
      name: "x",
      dependencies: { "@yagejs/core": "^0.6.0" },
    };
    expect(applyFeaturesToPackageJson(pkg, [])).toBe(pkg);
  });

  it("merges save and effects into dependencies", () => {
    const result = applyFeaturesToPackageJson(
      { name: "x", dependencies: { "@yagejs/core": "^0.6.0" } },
      ["save", "effects"],
    );
    expect(result.dependencies).toEqual({
      "@yagejs/core": "^0.6.0",
      "@yagejs/effects": "^0.6.0",
      "@yagejs/save": "^0.6.0",
    });
    // Sorted alphabetically.
    expect(Object.keys(result.dependencies ?? {})).toEqual([
      "@yagejs/core",
      "@yagejs/effects",
      "@yagejs/save",
    ]);
  });

  it("adds React deps and @types/react to devDependencies for ui", () => {
    const result = applyFeaturesToPackageJson(
      {
        name: "x",
        dependencies: { "@yagejs/core": "^0.6.0" },
        devDependencies: { typescript: "^5.9.0" },
      },
      ["ui"],
    );
    expect(result.dependencies).toMatchObject({
      "@yagejs/ui": "^0.6.0",
      "@yagejs/ui-react": "^0.6.0",
      react: "^19.0.0",
      "react-dom": "^19.0.0",
    });
    expect(result.devDependencies).toMatchObject({
      "@types/react": "^19.0.0",
      typescript: "^5.9.0",
    });
  });
});

describe("applyFeaturesToTsConfig", () => {
  it("adds jsx: react-jsx when ui is enabled", () => {
    const result = applyFeaturesToTsConfig(
      { compilerOptions: { strict: true } },
      ["ui"],
    );
    expect(result.compilerOptions).toEqual({ strict: true, jsx: "react-jsx" });
  });

  it("leaves tsconfig untouched for features with no compiler options", () => {
    const result = applyFeaturesToTsConfig(
      { compilerOptions: { strict: true } },
      ["save", "effects"],
    );
    expect(result.compilerOptions).toEqual({ strict: true });
  });
});

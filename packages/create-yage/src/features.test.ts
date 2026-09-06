import { describe, expect, it } from "vitest";
import {
  EDITOR_RANGE,
  FEATURES,
  isFeatureId,
  parseFeatureList,
  YAGE_RANGE,
} from "./features.js";
import {
  applyFeaturesToPackageJson,
  applyFeaturesToTsConfig,
} from "./scaffold.js";

describe("feature registry", () => {
  it("knows the documented feature ids", () => {
    expect(isFeatureId("ui")).toBe(true);
    expect(isFeatureId("save")).toBe(true);
    expect(isFeatureId("effects")).toBe(true);
    expect(isFeatureId("editor")).toBe(true);
    expect(isFeatureId("xyz")).toBe(false);
  });

  it("declares package deps for each feature", () => {
    expect(FEATURES.ui.dependencies).toHaveProperty("@yagejs/ui");
    expect(FEATURES.ui.dependencies).toHaveProperty("@yagejs/ui-react");
    expect(FEATURES.ui.dependencies).toHaveProperty("react");
    expect(FEATURES.ui.dependencies).toHaveProperty("react-dom");
    expect(FEATURES.ui.devDependencies).toHaveProperty("@types/react");
    expect(FEATURES.ui.tsconfigOptions).toEqual({ jsx: "react-jsx" });

    expect(FEATURES.save.dependencies).toEqual({ "@yagejs/save": YAGE_RANGE });
    expect(FEATURES.effects.dependencies).toEqual({
      "@yagejs/effects": YAGE_RANGE,
    });
  });

  it("gives the editor a runtime level dep, a dev dep, a script and a step", () => {
    expect(FEATURES.editor.dependencies).toEqual({
      "@yagejs/level": YAGE_RANGE,
    });
    expect(FEATURES.editor.devDependencies).toEqual({
      "@yagejs-tools/editor": EDITOR_RANGE,
    });
    expect(FEATURES.editor.scripts).toEqual({ editor: "yage-editor" });
    expect(FEATURES.editor.nextSteps).toEqual(["npx yage-editor init"]);
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

  it("errors on empty or whitespace-only input", () => {
    const empty = parseFeatureList("");
    expect("error" in empty && empty.error).toContain("No features specified");
    const whitespace = parseFeatureList(" , ,");
    expect("error" in whitespace && whitespace.error).toContain(
      "No features specified",
    );
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
      "@yagejs/effects": YAGE_RANGE,
      "@yagejs/save": YAGE_RANGE,
    });
    // Sorted alphabetically.
    expect(Object.keys(result.dependencies ?? {})).toEqual([
      "@yagejs/core",
      "@yagejs/effects",
      "@yagejs/save",
    ]);
  });

  it("does not add an empty devDependencies key when none are needed", () => {
    const result = applyFeaturesToPackageJson(
      { name: "x", dependencies: { "@yagejs/core": "^0.6.0" } },
      ["save"],
    );
    expect("devDependencies" in result).toBe(false);
  });

  it("preserves an existing devDependencies key even with no feature devDeps", () => {
    const result = applyFeaturesToPackageJson(
      {
        name: "x",
        dependencies: { "@yagejs/core": "^0.6.0" },
        devDependencies: { typescript: "^5.9.0" },
      },
      ["save"],
    );
    expect(result.devDependencies).toEqual({ typescript: "^5.9.0" });
  });

  it("adds the editor script after the template's own scripts", () => {
    const result = applyFeaturesToPackageJson(
      {
        name: "x",
        scripts: { dev: "vite", build: "vite build" },
        dependencies: { "@yagejs/core": "^0.6.0" },
        devDependencies: { typescript: "^5.9.0" },
      },
      ["editor"],
    );
    expect(result.dependencies).toMatchObject({
      "@yagejs/level": YAGE_RANGE,
    });
    expect(result.devDependencies).toMatchObject({
      "@yagejs-tools/editor": EDITOR_RANGE,
      typescript: "^5.9.0",
    });
    expect(Object.entries(result.scripts ?? {})).toEqual([
      ["dev", "vite"],
      ["build", "vite build"],
      ["editor", "yage-editor"],
    ]);
  });

  it("does not add an empty scripts key for a feature that adds none", () => {
    const result = applyFeaturesToPackageJson(
      { name: "x", dependencies: { "@yagejs/core": "^0.6.0" } },
      ["save"],
    );
    expect("scripts" in result).toBe(false);
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
      "@yagejs/ui": YAGE_RANGE,
      "@yagejs/ui-react": YAGE_RANGE,
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

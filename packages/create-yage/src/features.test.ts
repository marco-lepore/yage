import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { REQUIRED_PACKAGES } from "@yagejs-tools/pack";
import { describe, expect, it } from "vitest";
import {
  EDITOR_RANGE,
  FEATURES,
  isFeatureId,
  PACK_RANGE,
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
    expect(isFeatureId("electron")).toBe(true);
    expect(isFeatureId("capacitor")).toBe(true);
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

describe("packaging features", () => {
  /** A package's manifest, read from its own directory in this repository. */
  function manifest(name: string): {
    peerDependencies?: Record<string, string>;
  } {
    const file = fileURLToPath(
      new URL(`../../${name}/package.json`, import.meta.url),
    );
    return JSON.parse(readFileSync(file, "utf8")) as {
      peerDependencies?: Record<string, string>;
    };
  }

  it("gives Electron the host package, the build tools and the setup step", () => {
    expect(FEATURES.electron.dependencies).toEqual({
      "@yagejs/host-electron": YAGE_RANGE,
    });
    expect(FEATURES.electron.devDependencies).toEqual({
      electron: "^44.7.0",
      "@electron-forge/cli": "^8.0.1",
      "@electron-forge/maker-zip": "^8.0.1",
      "@electron-forge/plugin-fuses": "^8.0.1",
      "@electron/fuses": "^2.1.3",
      "@yagejs-tools/pack": PACK_RANGE,
    });
    expect(FEATURES.electron.nextSteps).toEqual([
      "npx yage-pack init --target electron --app-id com.example.mygame",
    ]);
  });

  it("gives Capacitor every plugin the app itself has to list", () => {
    expect(FEATURES.capacitor.dependencies).toEqual({
      "@yagejs/host-capacitor": YAGE_RANGE,
      "@capacitor/core": "^8.5.3",
      "@capacitor/app": "^8.1.2",
      "@capacitor/filesystem": "^8.1.4",
      "@capacitor/screen-orientation": "^8.0.2",
      "@capacitor/ios": "^8.5.3",
      "@capacitor/android": "^8.5.3",
    });
    expect(FEATURES.capacitor.devDependencies).toEqual({
      "@capacitor/cli": "^8.5.3",
      "@yagejs-tools/pack": PACK_RANGE,
    });
    expect(FEATURES.capacitor.nextSteps).toEqual([
      "npx yage-pack init --target ios --target android --app-id com.example.mygame",
    ]);
  });

  it("asks for the versions each host adapter accepts", () => {
    const electron = manifest("host-electron").peerDependencies ?? {};
    expect(FEATURES.electron.devDependencies?.electron).toBe(electron.electron);

    const capacitor = manifest("host-capacitor").peerDependencies ?? {};
    for (const [name, range] of Object.entries(capacitor)) {
      expect([name, FEATURES.capacitor.dependencies[name]]).toEqual([
        name,
        range,
      ]);
    }
  });

  it("installs exactly what each target's build needs", () => {
    expect(Object.keys(FEATURES.electron.dependencies).sort()).toEqual(
      [...REQUIRED_PACKAGES.electron.dependencies].sort(),
    );
    expect(Object.keys(FEATURES.electron.devDependencies ?? {}).sort()).toEqual(
      [...REQUIRED_PACKAGES.electron.devDependencies].sort(),
    );

    const mobileDependencies = new Set([
      ...REQUIRED_PACKAGES.ios.dependencies,
      ...REQUIRED_PACKAGES.android.dependencies,
    ]);
    const mobileDevDependencies = new Set([
      ...REQUIRED_PACKAGES.ios.devDependencies,
      ...REQUIRED_PACKAGES.android.devDependencies,
    ]);
    expect(Object.keys(FEATURES.capacitor.dependencies).sort()).toEqual(
      [...mobileDependencies].sort(),
    );
    expect(
      Object.keys(FEATURES.capacitor.devDependencies ?? {}).sort(),
    ).toEqual([...mobileDevDependencies].sort());
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

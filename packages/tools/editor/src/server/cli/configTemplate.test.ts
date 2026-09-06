import { describe, expect, it } from "vitest";
import { LEVEL_PROJECT_SOURCE, renderEditorConfig } from "./configTemplate.js";

describe("renderEditorConfig", () => {
  it("points the modules at what init writes beside the config", () => {
    const source = renderEditorConfig({
      levels: ["levels/*.yage-level.json"],
      assets: [],
    });

    expect(source).toContain('project: "../src/levelProject.ts",');
    expect(source).toContain('harness: "./harness.ts",');
  });

  it("writes a bare glob when the project has no layers module", () => {
    const source = renderEditorConfig({
      levels: ["levels/*.yage-level.json", "src/levels/*.yage-level.json"],
      assets: [],
    });

    expect(source).toContain('    "levels/*.yage-level.json",');
    expect(source).toContain('    "src/levels/*.yage-level.json",');
    expect(source).toContain("// Pair a glob with the layers");
  });

  it("pairs every glob with the layers module the project has", () => {
    const source = renderEditorConfig({
      levels: ["levels/*.yage-level.json"],
      layers: "../src/layers.ts",
      assets: [],
    });

    expect(source).toContain(
      '{ glob: "levels/*.yage-level.json", layers: "../src/layers.ts" },',
    );
    expect(source).not.toContain("// Pair a glob with the layers");
  });

  it("writes the asset globs it was given", () => {
    const source = renderEditorConfig({
      levels: ["levels/*.yage-level.json"],
      assets: ["public/**/*.png"],
    });

    expect(source).toContain('assets: ["public/**/*.png"],');
  });

  // Globs matching nothing would make the picker look broken, so a project
  // with no public directory gets the option named instead.
  it("names the assets option rather than guessing a glob", () => {
    const source = renderEditorConfig({
      levels: ["levels/*.yage-level.json"],
      assets: [],
    });

    expect(source).not.toMatch(/^ {2}assets: \[/m);
    expect(source).toContain("// Add `assets:");
  });

  // A page that does not exist is refused at startup, so it is never written.
  it("names the game page option rather than guessing a page", () => {
    const source = renderEditorConfig({
      levels: ["levels/*.yage-level.json"],
      assets: [],
    });

    expect(source).not.toMatch(/^ {2}gamePage:/m);
    expect(source).toContain("// Add `gamePage:");
  });
});

describe("LEVEL_PROJECT_SOURCE", () => {
  it("declares an empty project, because placeability is not guessable", () => {
    expect(LEVEL_PROJECT_SOURCE).toContain(
      "export default defineLevelProject({ entities: [] });",
    );
    expect(LEVEL_PROJECT_SOURCE).toContain(
      'import { defineLevelProject } from "@yagejs/level";',
    );
  });
});

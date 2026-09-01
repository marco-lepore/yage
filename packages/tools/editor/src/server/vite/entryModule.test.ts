import { describe, expect, it } from "vitest";
import { renderEntryModule } from "./entryModule.js";

const MODULES = {
  project: "/src/levelProject.ts",
  harness: "/lab/harness.ts",
};

describe("renderEntryModule", () => {
  it("imports the project modules and mounts the editor", () => {
    const source = renderEntryModule({ modules: MODULES, contributions: [] });

    expect(source).toContain('import project from "/src/levelProject.ts";');
    expect(source).toContain('import harness from "/lab/harness.ts";');
    expect(source).toContain(
      'import { mountEditor } from "@yagejs-tools/editor/browser";',
    );
    expect(source).toContain("await mountEditor({");
  });

  it("passes no game page when the project configured none", () => {
    const source = renderEntryModule({ modules: MODULES, contributions: [] });

    expect(source).toContain("gamePage: undefined,");
  });

  it("passes the game page as a string literal", () => {
    const source = renderEntryModule({
      modules: MODULES,
      contributions: [],
      gamePage: '/game".html',
    });

    expect(source).toContain('gamePage: "/game\\".html",');
  });

  it("names one import per contribution and passes them in order", () => {
    const source = renderEntryModule({
      modules: MODULES,
      contributions: ["@yagejs/renderer/level", "@yagejs/physics/level"],
    });

    expect(source).toContain(
      'import contribution0 from "@yagejs/renderer/level";',
    );
    expect(source).toContain(
      'import contribution1 from "@yagejs/physics/level";',
    );
    expect(source).toContain("contributions: [contribution0, contribution1],");
  });

  it("escapes a path rather than emitting it as source", () => {
    // Path validation is what stops this reaching here; the escaping is the
    // second check, so a quote can never close a string literal.
    const source = renderEntryModule({
      modules: { ...MODULES, project: '/src/a".ts' },
      contributions: [],
    });

    expect(source).toContain('import project from "/src/a\\".ts";');
  });
});

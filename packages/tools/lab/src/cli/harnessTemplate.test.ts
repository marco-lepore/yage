import { describe, expect, it } from "vitest";
import { planHarness } from "./harnessTemplate.js";

/** Every package the table knows about, so a case covers the whole of it. */
const ALL = new Set([
  "@yagejs/core",
  "@yagejs/renderer",
  "@yagejs/physics",
  "@yagejs/input",
  "@yagejs/audio",
  "@yagejs/lighting",
  "@yagejs/particles",
  "@yagejs/tilemap",
  "@yagejs/ui",
  "@yagejs/ui-react",
  "@yagejs/debug",
]);

/** The class names an `import { X } from "..."` line brings in. */
function importedClasses(source: string): string[] {
  return [...source.matchAll(/^import \{ (\w+) \} from/gm)].map(
    (match) => match[1] as string,
  );
}

describe("planHarness", () => {
  it("writes only the plugins the project depends on", () => {
    const { source, plugins } = planHarness(
      new Set(["@yagejs/core", "@yagejs/renderer"]),
    );

    expect(plugins).toEqual(["RendererPlugin"]);
    expect(source).toContain("new RendererPlugin({");
    expect(source).not.toContain("PhysicsPlugin");
  });

  it("imports exactly the classes it constructs", () => {
    const { source } = planHarness(ALL);
    const constructed = [...source.matchAll(/new (\w+)\(/g)].map(
      (match) => match[1] as string,
    );

    expect(new Set(importedClasses(source))).toEqual(
      new Set([...constructed, "Engine", "defineHarness"]),
    );
  });

  it("leaves SavePlugin out, because its Save is the game's own", () => {
    const { source } = planHarness(new Set([...ALL, "@yagejs/save"]));

    expect(source).not.toContain("SavePlugin");
  });

  it("points at the game's action map rather than inventing one", () => {
    const { source } = planHarness(ALL);

    expect(source).toContain("new InputPlugin()");
    expect(source).toContain("// Copy the game's action map in");
  });

  it("starts the engine in debug mode, which the Inspector needs", () => {
    expect(planHarness(ALL).source).toContain("new Engine({ debug: true })");
  });

  it("sizes the renderer from the harness constants", () => {
    const { source } = planHarness(ALL);

    expect(source).toMatch(/export const WIDTH = \d+;/);
    expect(source).toContain("width: WIDTH,");
    expect(source).toContain("height: HEIGHT,");
  });

  // UIReactPlugin declares `dependencies = ["ui"]`, so a harness carrying it
  // without UIPlugin throws from engine.start() before a scenario can mount.
  it("skips UIReactPlugin when @yagejs/ui is not declared", () => {
    const { source, plugins, skipped } = planHarness(
      new Set(["@yagejs/core", "@yagejs/renderer", "@yagejs/ui-react"]),
    );

    expect(source).not.toContain("UIReactPlugin");
    expect(plugins).toEqual(["RendererPlugin"]);
    expect(skipped).toEqual([
      { className: "UIReactPlugin", missing: ["@yagejs/ui"] },
    ]);
  });

  it("writes UIReactPlugin once @yagejs/ui is there too", () => {
    const { source, skipped } = planHarness(
      new Set([
        "@yagejs/core",
        "@yagejs/renderer",
        "@yagejs/ui",
        "@yagejs/ui-react",
      ]),
    );

    expect(source).toContain("new UIPlugin()");
    expect(source).toContain("new UIReactPlugin()");
    expect(skipped).toEqual([]);
  });

  it("reports no plugins for a project with no engine packages", () => {
    expect(planHarness(new Set(["vite"])).plugins).toEqual([]);
  });
});

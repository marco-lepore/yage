import { describe, expect, it } from "vitest";
import { planHarness, renderHarnessReexport } from "./harnessTemplate.js";

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
      new Set([...constructed, "Engine"]),
    );
  });

  // Both tools accept the same object, so the file compiles in a project that
  // has neither of them as a dependency of its own.
  it("default-exports a plain object, with no tool import", () => {
    const { source } = planHarness(ALL);

    expect(source).toContain("export default {");
    expect(source).toContain("engine: () => new Engine({ debug: true })");
    expect(source).toContain(
      "plugins: ({ container }: { container: HTMLElement }) => [",
    );
    expect(source).not.toContain("@yagejs-tools");
  });

  it("leaves SavePlugin out, because its Save is the game's own", () => {
    const { source } = planHarness(new Set([...ALL, "@yagejs/save"]));

    expect(source).not.toContain("SavePlugin");
  });

  // The editor holds every placement inactive, so a seeded RNG has no effect
  // on the preview and would follow the level into Play.
  it("writes DebugPlugin without a seed", () => {
    const { source, plugins } = planHarness(ALL);

    expect(source).toContain("new DebugPlugin()");
    expect(source).not.toContain("deterministicSeed");
    expect(plugins).toContain("DebugPlugin");
  });

  it("points at the game's action map rather than inventing one", () => {
    const { source } = planHarness(ALL);

    expect(source).toContain("new InputPlugin()");
    expect(source).toContain("// Copy the game's action map in");
  });

  it("sizes the renderer from the view constant", () => {
    const { source } = planHarness(ALL);

    expect(source).toMatch(/const VIEW = \{ width: \d+, height: \d+ \};/);
    expect(source).toContain("width: VIEW.width,");
    expect(source).toContain("height: VIEW.height,");
  });

  // `noUnusedLocals` is on in every YAGE project, so a constant nothing sizes
  // itself from would fail the project's own typecheck.
  it("leaves the view constant out when nothing measures against it", () => {
    const { source } = planHarness(new Set(["@yagejs/core", "@yagejs/audio"]));

    expect(source).not.toContain("const VIEW");
  });

  // UIReactPlugin declares `dependencies = ["ui"]`, so a harness carrying it
  // without UIPlugin throws from engine.start() before anything is drawn.
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

describe("renderHarnessReexport", () => {
  it("hands the named harness over in one line", () => {
    const source = renderHarnessReexport("../lab/harness.js");

    expect(source).toContain('export { default } from "../lab/harness.js";');
    expect(source).not.toContain("new Engine");
  });
});

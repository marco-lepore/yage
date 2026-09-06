import { WRITTEN_BY } from "./configTemplate.js";

/** The plugin an engine package contributes to a generated harness. */
interface PluginEntry {
  /** The package that has to be a dependency for this plugin to be written. */
  readonly pkg: string;
  readonly className: string;
  /** The constructor call, indented to sit inside the `plugins` array. */
  readonly call: string;
  /** Written as a comment above the call. */
  readonly note?: string;
  /**
   * Packages that must also be declared. A plugin naming another in its
   * `dependencies` fails `engine.start()` when that one is absent, and a
   * package pulled in only transitively cannot be imported under a strict
   * node_modules layout.
   */
  readonly requires?: readonly string[];
}

/**
 * Listed in the order a game constructs them, which reads well but is not
 * load-bearing: `Engine.start()` installs plugins in the topological order of
 * their own `dependencies`.
 *
 * `@yagejs/save` is absent on purpose. `SavePlugin` takes a `Save` the game
 * constructs, and a guessed one would restore into the wrong storage.
 */
const PLUGINS: readonly PluginEntry[] = [
  {
    pkg: "@yagejs/renderer",
    className: "RendererPlugin",
    call: `new RendererPlugin({
      width: VIEW.width,
      height: VIEW.height,
      backgroundColor: 0x0f172a,
      container,
    })`,
  },
  {
    pkg: "@yagejs/physics",
    className: "PhysicsPlugin",
    call: "new PhysicsPlugin({ gravity: { x: 0, y: 980 } })",
  },
  {
    pkg: "@yagejs/input",
    className: "InputPlugin",
    // An action map is the game's own. One invented here would name actions
    // the game does not have.
    note: "Copy the game's action map in, so a placement that reads one finds it.",
    call: "new InputPlugin()",
  },
  {
    pkg: "@yagejs/audio",
    className: "AudioPlugin",
    call: "new AudioPlugin()",
  },
  {
    pkg: "@yagejs/lighting",
    className: "LightingPlugin",
    call: "new LightingPlugin()",
  },
  {
    pkg: "@yagejs/particles",
    className: "ParticlesPlugin",
    call: "new ParticlesPlugin()",
  },
  {
    pkg: "@yagejs/tilemap",
    className: "TilemapPlugin",
    call: "new TilemapPlugin()",
  },
  {
    pkg: "@yagejs/ui",
    className: "UIPlugin",
    call: "new UIPlugin()",
  },
  {
    pkg: "@yagejs/ui-react",
    className: "UIReactPlugin",
    call: "new UIReactPlugin()",
    requires: ["@yagejs/ui"],
  },
  {
    pkg: "@yagejs/debug",
    className: "DebugPlugin",
    // The editor holds every placement inactive, so a fixed RNG seed has no
    // effect on the preview, and it would follow the level into Play.
    call: "new DebugPlugin()",
  },
];

/** A plugin the project has a package for, but cannot use yet. */
export interface SkippedPlugin {
  readonly className: string;
  /** The packages it needs that the project does not declare. */
  readonly missing: readonly string[];
}

export interface HarnessPlan {
  /** The harness source. */
  readonly source: string;
  /** Class names written into it. */
  readonly plugins: readonly string[];
  /** Plugins left out, so the caller can say why. */
  readonly skipped: readonly SkippedPlugin[];
}

/** What the generated harness sizes its renderer to, in virtual pixels. */
const VIEW_WIDTH = 1280;
const VIEW_HEIGHT = 720;

/** Where the harness the editor writes goes, relative to the config file. */
export const HARNESS_FILE = "editor/harness.ts";

/**
 * Plan `editor/harness.ts` for a project declaring `dependencies`.
 *
 * Only packages the project declares are written, so the file compiles against
 * what is installed rather than against what a game might want.
 */
export function planHarness(dependencies: ReadonlySet<string>): HarnessPlan {
  const plugins: PluginEntry[] = [];
  const skipped: SkippedPlugin[] = [];
  for (const entry of PLUGINS) {
    if (!dependencies.has(entry.pkg)) continue;
    const missing = (entry.requires ?? []).filter(
      (pkg) => !dependencies.has(pkg),
    );
    if (missing.length > 0) {
      skipped.push({ className: entry.className, missing });
      continue;
    }
    plugins.push(entry);
  }
  return {
    source: render(plugins),
    plugins: plugins.map((entry) => entry.className),
    skipped,
  };
}

/**
 * A harness that hands the scenario lab's over, for a project that already has
 * one. Both tools accept the same `{ engine, plugins }` object, so the link is
 * one line of the project's own code rather than a dependency between them.
 */
export function renderHarnessReexport(specifier: string): string {
  return `${WRITTEN_BY}
// The scenario lab's harness, so both tools run the same engine. Replace it
// with a harness of its own the day the two need to differ, or with the game's
// own engine module when it has one.
export { default } from "${specifier}";
`;
}

function render(plugins: readonly PluginEntry[]): string {
  const imports = [
    `import { Engine } from "@yagejs/core";`,
    ...plugins.map(
      (entry) => `import { ${entry.className} } from "${entry.pkg}";`,
    ),
  ].join("\n");

  const body = plugins
    .map((entry) => {
      const note = entry.note === undefined ? "" : `    // ${entry.note}\n`;
      return `${note}    ${entry.call},`;
    })
    .join("\n");

  // Only when something sizes itself from it: an unused const would fail the
  // project's own `noUnusedLocals`.
  const view = body.includes("VIEW.")
    ? `\n/** What the preview draws in, in virtual pixels. */\nconst VIEW = { width: ${VIEW_WIDTH}, height: ${VIEW_HEIGHT} };\n`
    : "";

  return `${WRITTEN_BY}
${imports}
${view}
/**
 * The engine and plugins the editor's viewport runs.
 *
 * Keep it in step with the game's own boot — a preview built from a different
 * engine draws a level the game will not. When the game builds its engine in a
 * module of its own, import that here instead.
 */
export default {
  engine: () => new Engine({ debug: true }),
  plugins: ({ container }: { container: HTMLElement }) => [
${body}
  ],
};
`;
}

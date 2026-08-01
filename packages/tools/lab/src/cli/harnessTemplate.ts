import {
  DEFAULT_HARNESS_HEIGHT,
  DEFAULT_HARNESS_WIDTH,
} from "../grammar/harness.js";

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
      width: WIDTH,
      height: HEIGHT,
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
    // An action map is the game's own. One invented here would let a scenario
    // drive an action the game does not have.
    note: "Copy the game's action map in, so scenarios drive the same actions.",
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
    // The lab appends this plugin when a harness omits it, so the entry earns
    // its place through the seed alone.
    note: "Fixes every scene's RNG seed, so a scenario replays the same way.",
    call: "new DebugPlugin({ deterministicSeed: 1 })",
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

/**
 * Plans `lab/harness.ts` for a project declaring `dependencies`.
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

function render(plugins: readonly PluginEntry[]): string {
  const imports = [
    `import { Engine } from "@yagejs/core";`,
    ...plugins.map(
      (entry) => `import { ${entry.className} } from "${entry.pkg}";`,
    ),
    `import { defineHarness } from "@yagejs-tools/lab";`,
  ].join("\n");

  const body = plugins
    .map((entry) => {
      const note = entry.note === undefined ? "" : `    // ${entry.note}\n`;
      return `${note}    ${entry.call},`;
    })
    .join("\n");

  return `// Written by \`yage-lab init\`. Edit freely.
${imports}

export const WIDTH = ${DEFAULT_HARNESS_WIDTH};
export const HEIGHT = ${DEFAULT_HARNESS_HEIGHT};

/**
 * The engine and plugins every scenario on the page runs against. Keep it in
 * step with the game's own boot — a harness that drifts from the game proves
 * nothing about it.
 */
export default defineHarness({
  width: WIDTH,
  height: HEIGHT,
  engine: () => new Engine({ debug: true }),
  plugins: ({ container }) => [
${body}
  ],
});
`;
}

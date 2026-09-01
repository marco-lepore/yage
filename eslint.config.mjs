// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

// Import boundaries for the level editor and @yagejs/level.
//
// Exactly one block below matches any file: flat config *replaces* a rule's
// options when two blocks match the same file, so an overlapping pair would
// switch each other's restrictions off with no error. Each block therefore
// repeats every restriction that applies to its files, and narrower directories
// are carved out of broader ones with `ignores`. Merging two blocks whose
// scopes overlap reintroduces the defect.
//
// The other half of that property is quieter: a file no block matches is not
// reported as unrestricted, it is not reported at all. Adding a directory or a
// file extension to either package means checking that some block governs it.
//
// These rules see static `import` and `export … from` only. A dynamic
// `import()` reaches any of these specifiers with no error, and unprefixed Node
// built-ins (`fs` rather than `node:fs`) are not covered either.
const EDITOR = "packages/tools/editor";
const LEVEL = "packages/level";

// Directory groups name the bare specifier as well as the paths under it:
// `**/server/**` needs at least one segment after `server`, so `../../server`
// alone would pass.
const NO_SERVER = {
  group: ["**/server", "**/server/**"],
  message: "Browser code must not import server code.",
};
const NO_NODE = {
  group: ["node:*"],
  message: "Browser code must not use Node built-ins.",
};
const VITE_TYPES = {
  group: ["vite"],
  allowTypeImports: true,
  message: "Vite is a server dependency; only its types may appear here.",
};
const NO_REACT = {
  group: ["react", "react-dom"],
  message:
    "Only src/browser/shell renders; the shell adapts these modules to React.",
};
const NO_BROWSER = {
  group: ["**/browser", "**/browser/**"],
  message: "Server code must not import browser code.",
};
// A group, not `paths`: `paths` matches the exact specifier only, so it would
// let `react-dom/client` — the specifier a React render actually uses — and
// `pixi.js/scene` straight through.
const NO_RENDER = {
  group: ["pixi.js", "react", "react-dom"],
  message: "Server code never renders.",
};
// Every engine package by name. @yagejs/level is deliberately absent: a group
// pattern matches the specifier and everything under it, so naming it would
// also restrict @yagejs/level/document, which block E allows.
const ENGINE = [
  "@yagejs/core",
  "@yagejs/renderer",
  "@yagejs/physics",
  "@yagejs/tilemap",
  "@yagejs/input",
  "@yagejs/audio",
  "@yagejs/particles",
  "@yagejs/lighting",
  "@yagejs/pathfinding",
  "@yagejs/ui",
  "@yagejs/ui-react",
  "@yagejs/debug",
  "@yagejs/save",
  "@yagejs/effects",
];

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strict,
  prettier,
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "_reference/**",
      "**/*.config.*",
    ],
  },
  {
    rules: {
      // TODO: re-enable once codebase is cleaned up
      "@typescript-eslint/no-non-null-assertion": "warn",
    },
  },
  {
    // Tests lean on `arr[0]!` after a known-length array — the non-null assertion
    // is idiomatic and safe there — so it isn't worth flagging in the dialogue
    // addon's test files; keeps the addon's lint output to actionable source warnings.
    files: ["packages/addons/dialogue/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: ["packages/**/src/**/*.ts", "packages/**/src/**/*.tsx"],
    ignores: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "packages/core/src/Random.ts",
    ],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message:
            "Use RandomService or globalRandom instead of Math.random() in runtime source.",
        },
      ],
    },
  },
  {
    files: ["packages/**/src/**/*.ts", "packages/**/src/**/*.tsx"],
    ignores: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "packages/core/src/GameLoop.ts",
      "packages/core/src/Inspector.ts",
      "packages/core/src/Logger.ts",
      "packages/core/src/Random.ts",
      "packages/debug/src/DebugPlugin.ts",
      "packages/save/src/Save.ts",
      "packages/tools/lab/src/cli/test.ts",
      "packages/tools/lab/src/runner/LabClock.ts",
      "packages/tools/lab/src/runner/runDrive.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.object.name='Date'][callee.property.name='now']",
          message:
            "Use engine time instead of Date.now() outside approved infrastructure files.",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.object.name='performance'][callee.property.name='now']",
          message:
            "Use engine time instead of performance.now() outside approved infrastructure files.",
        },
      ],
    },
  },
  {
    files: ["packages/**/src/**/*.ts", "packages/**/src/**/*.tsx"],
    ignores: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "packages/tools/lab/src/cli/test.ts",
      "packages/tools/lab/src/runner/LabPanel.ts",
      "packages/tools/lab/src/runner/mountLab.ts",
    ],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "setTimeout",
          message:
            "Use engine-time processes or scene lifecycle APIs instead of setTimeout() in runtime source.",
        },
        {
          name: "setInterval",
          message:
            "Use engine-time processes or systems instead of setInterval() in runtime source.",
        },
      ],
    },
  },

  // A. Browser code outside the shell, the preview, and the play page. No
  //    server code, no Node built-ins, no engine: every module here reaches
  //    the engine through PreviewCoordinator's API.
  //
  //    `play/` is the second module that owns an engine, and deliberately a
  //    separate one: it boots the project's harness in its own page to run
  //    the level live, which is exactly what the preview must never do. It is
  //    excused here and governed by block C, which holds the same platform
  //    restrictions without the engine ban.
  {
    files: [`${EDITOR}/src/browser/**/*.ts`, `${EDITOR}/src/browser/**/*.tsx`],
    ignores: [
      `${EDITOR}/src/browser/shell/**`,
      `${EDITOR}/src/browser/preview/**`,
      `${EDITOR}/src/browser/play/**`,
      `${EDITOR}/src/browser/mount.ts`,
      `${EDITOR}/src/browser/mount.tsx`,
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            NO_SERVER,
            NO_NODE,
            VITE_TYPES,
            // @yagejs/level is absent on purpose: ProjectCoordinator builds the
            // catalog and EditorStore validates with its pure functions. The
            // boundary here is who owns engine objects, not bundle contents.
            {
              group: [...ENGINE, "pixi.js"],
              allowTypeImports: true,
              message:
                "Only src/browser/preview and src/browser/play may evaluate engine code.",
            },
            // Five of the six module sections that say "No React"; block C
            // carries the same rule for the sixth, PreviewCoordinator.
            NO_REACT,
          ],
        },
      ],
    },
  },

  // B. The React shell. Everything in block A applies, plus: components send
  //    intents through CommandController and the coordinators, and reach the
  //    preview through its barrel rather than its internals.
  {
    files: [
      `${EDITOR}/src/browser/shell/**/*.ts`,
      `${EDITOR}/src/browser/shell/**/*.tsx`,
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            NO_SERVER,
            NO_NODE,
            VITE_TYPES,
            {
              group: ["**/api", "**/api/**"],
              message:
                "Components talk to CommandController and the coordinators, not the API client.",
            },
            // Matches a path below the preview directory, so the barrel
            // (../preview/index.js) stays reachable and internals do not.
            {
              group: ["**/preview/*/**"],
              message:
                "Use PreviewCoordinator through its barrel, not preview internals.",
            },
            {
              group: [...ENGINE, "pixi.js"],
              message:
                "The engine draws inside the viewport canvas; components never touch it.",
            },
            {
              group: ["@yagejs/level", "@yagejs/level/*"],
              allowTypeImports: true,
              message:
                "Components name level types; the coordinators do the level work.",
            },
          ],
        },
      ],
    },
  },

  // C. The two directories that evaluate engine code: the preview, which
  //    projects the document without running it, and the play page, which
  //    runs it. The platform restrictions still apply to both.
  {
    files: [
      `${EDITOR}/src/browser/preview/**/*.ts`,
      `${EDITOR}/src/browser/preview/**/*.tsx`,
      `${EDITOR}/src/browser/play/**/*.ts`,
      `${EDITOR}/src/browser/play/**/*.tsx`,
    ],
    rules: {
      // PreviewCoordinator is the sixth module section that says "No React".
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: [NO_SERVER, NO_NODE, VITE_TYPES, NO_REACT] },
      ],
    },
  },

  // C2. The composition root. Block A's rules, except that it renders the shell
  //     and therefore needs React. It is the one browser module allowed to
  //     import every other, which is what a composition root does. Both
  //     extensions: the root renders the shell, so `mount.tsx` is as likely as
  //     `mount.ts`, and under block A it would be forbidden React.
  {
    files: [
      `${EDITOR}/src/browser/mount.ts`,
      `${EDITOR}/src/browser/mount.tsx`,
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            NO_SERVER,
            NO_NODE,
            VITE_TYPES,
            {
              group: [...ENGINE, "pixi.js"],
              allowTypeImports: true,
              message:
                "Only src/browser/preview and src/browser/play may evaluate engine code.",
            },
          ],
        },
      ],
    },
  },

  // D. Server code outside the file service. No browser code, no rendering, and
  //    no engine or entity evaluation.
  {
    files: [`${EDITOR}/src/server/**/*.ts`, `${EDITOR}/src/server/**/*.tsx`],
    ignores: [`${EDITOR}/src/server/files/**`, `${EDITOR}/src/server/draft/**`],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            NO_RENDER,
            NO_BROWSER,
            {
              group: [...ENGINE, "@yagejs/level"],
              allowTypeImports: true,
              message:
                "Server startup must not evaluate engine or entity modules; types only.",
            },
          ],
        },
      ],
    },
  },

  // E. The two directories that handle level documents. Everything in block D
  //    applies, except that the one sanctioned value import is reachable:
  //    @yagejs/level/document carries the document layer alone and imports no
  //    engine code, so parsing and canonical formatting cost the server nothing
  //    it is forbidden. The file service reads and writes through it; the draft
  //    service checks each accepted document against it, which is the rule that
  //    keeps a draft from holding something a save would write and no reader
  //    could parse back. The level barrel is restricted through `paths`, which
  //    matches that exact specifier and does not extend to its subpaths.
  {
    files: [
      `${EDITOR}/src/server/files/**/*.ts`,
      `${EDITOR}/src/server/files/**/*.tsx`,
      `${EDITOR}/src/server/draft/**/*.ts`,
      `${EDITOR}/src/server/draft/**/*.tsx`,
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          // `paths` matches the exact specifier and does not extend to
          // subpaths, which is what keeps @yagejs/level/document reachable.
          paths: [
            {
              name: "@yagejs/level",
              allowTypeImports: true,
              message:
                "The barrel carries the runtime loader; parse through @yagejs/level/document.",
            },
          ],
          patterns: [
            NO_RENDER,
            NO_BROWSER,
            {
              group: ENGINE,
              allowTypeImports: true,
              message:
                "The server evaluates document code, never engine code; types only.",
            },
          ],
        },
      ],
    },
  },

  // F. Shared code: only types from @yagejs/level, nothing else external.
  {
    files: [`${EDITOR}/src/shared/**/*.ts`, `${EDITOR}/src/shared/**/*.tsx`],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/browser",
                "**/browser/**",
                "**/server",
                "**/server/**",
              ],
              message:
                "Shared code is imported by both sides and may depend on neither.",
            },
            {
              group: ["node:*", "vite", "react", "react-dom", "pixi.js"],
              message:
                "Shared code runs on both sides; no platform or framework imports.",
            },
            {
              group: ["@yagejs/*", "!@yagejs/level"],
              message:
                "Shared code may depend only on @yagejs/level, and only on its types.",
            },
            {
              group: ["@yagejs/level", "@yagejs/level/*"],
              allowTypeImports: true,
              message:
                "Type-only imports from @yagejs/level; the reducer must not evaluate engine code.",
            },
          ],
        },
      ],
    },
  },

  // G. Entry files at the top of src/, except the two side-specific ones below.
  //    `src/index.ts` is imported by both sides, so it depends on neither: it
  //    declares `defineEditorConfig` (an identity function carrying types) and
  //    re-exports public types, rather than re-exporting from `./browser/` or
  //    `./server/`. No `**`: this matches the top level only.
  {
    files: [`${EDITOR}/src/*.ts`, `${EDITOR}/src/*.tsx`],
    ignores: [
      `${EDITOR}/src/browser.ts`,
      `${EDITOR}/src/cli.ts`,
      `${EDITOR}/src/*.test.ts`,
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["pixi.js", "react", "react-dom"],
              message: "Both sides import this entry, so it renders nothing.",
            },
            {
              group: [
                "**/browser",
                "**/browser/**",
                "**/server",
                "**/server/**",
              ],
              message:
                "Both sides import this entry, so it may re-export from neither.",
            },
            {
              group: ["node:*", "vite"],
              message:
                "Both sides import this entry, so it stays platform-neutral.",
            },
            {
              group: [...ENGINE, "@yagejs/level"],
              allowTypeImports: true,
              message:
                "Entry files name engine types, never evaluate engine code.",
            },
          ],
        },
      ],
    },
  },

  // G2. Tests beside those entries. Vitest runs them in Node, so the
  //     platform neutrality block G asks of the entries themselves does not
  //     apply; what still holds is that nothing here renders.
  {
    files: [`${EDITOR}/src/*.test.ts`],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["pixi.js", "react", "react-dom"],
              message: "A test at this level renders nothing.",
            },
          ],
        },
      ],
    },
  },

  // H. The browser entry. It re-exports the mount, so it carries the
  //    composition root's restrictions (block C2): block A's, without the React
  //    restriction, which belongs to the module directories that must not
  //    render rather than to a file that only re-exports.
  {
    files: [`${EDITOR}/src/browser.ts`],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            NO_SERVER,
            NO_NODE,
            VITE_TYPES,
            {
              group: [...ENGINE, "pixi.js"],
              allowTypeImports: true,
              message:
                "Only src/browser/preview and src/browser/play may evaluate engine code.",
            },
          ],
        },
      ],
    },
  },

  // I. The CLI entry. It re-exports the server CLI, so it carries block D's
  //    restrictions.
  {
    files: [`${EDITOR}/src/cli.ts`],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            NO_RENDER,
            NO_BROWSER,
            {
              group: [...ENGINE, "@yagejs/level"],
              allowTypeImports: true,
              message:
                "Server startup must not evaluate engine or entity modules; types only.",
            },
          ],
        },
      ],
    },
  },

  // J. Engine packages: nothing under packages/*/src may depend on the tools.
  //    Its own block rather than an addition to the one above, whose `ignores`
  //    would carry over. Both extensions: packages/ui-react has .tsx sources.
  //    packages/level carves itself out because blocks K and L restrict more.
  //    The glob has three path segments, so packages/addons/*/src and
  //    packages/tools/*/src are outside it, as they are outside the block above.
  {
    files: ["packages/*/src/**/*.ts", "packages/*/src/**/*.tsx"],
    ignores: [`${LEVEL}/src/**`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@yagejs-tools/*"],
              message: "Engine packages must not depend on development tools.",
            },
          ],
        },
      ],
    },
  },

  // K. @yagejs/level outside the document layer. A game depends on this package
  //    with no editor installed, and its allowed imports are @yagejs/core
  //    alone: dormant preview synchronization belongs to the editor, the
  //    physics placement adapter to the physics package's own subpath, and
  //    snapshot identity to the scene lifecycle rather than @yagejs/save.
  //    Block J's restriction is repeated here rather than inherited, because a
  //    second block matching the same file would replace it.
  {
    files: [`${LEVEL}/src/**/*.ts`, `${LEVEL}/src/**/*.tsx`],
    ignores: [
      `${LEVEL}/src/document.ts`,
      `${LEVEL}/src/document.tsx`,
      `${LEVEL}/src/document/**`,
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@yagejs-tools/*"],
              message: "Engine packages must not depend on development tools.",
            },
            {
              group: [
                ...ENGINE.filter((name) => name !== "@yagejs/core"),
                "pixi.js",
              ],
              message:
                "@yagejs/level depends on @yagejs/core and nothing else.",
            },
            {
              group: ["node:*"],
              message:
                "@yagejs/level parses level data it is handed; reading the file is the caller's job.",
            },
          ],
        },
      ],
    },
  },

  // L. The document layer, reachable as @yagejs/level/document. Block K's
  //    restrictions apply unchanged, plus the invariant that entry point exists
  //    for: it must create no runtime dependency on @yagejs/core, so the editor
  //    server can parse and format level files without evaluating engine code
  //    (block E lets the file service value-import it). Only @yagejs/core is
  //    relaxed to type-only, and only here — the other engine packages stay
  //    restricted in both forms, as they are in block K.
  {
    files: [
      `${LEVEL}/src/document.ts`,
      `${LEVEL}/src/document.tsx`,
      `${LEVEL}/src/document/**/*.ts`,
      `${LEVEL}/src/document/**/*.tsx`,
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@yagejs-tools/*"],
              message: "Engine packages must not depend on development tools.",
            },
            {
              group: [
                ...ENGINE.filter((name) => name !== "@yagejs/core"),
                "pixi.js",
              ],
              message:
                "@yagejs/level depends on @yagejs/core and nothing else.",
            },
            {
              group: ["@yagejs/core"],
              allowTypeImports: true,
              message:
                "The document layer parses data; a runtime import of @yagejs/core drags the engine into the editor server.",
            },
            {
              group: ["node:*"],
              message:
                "@yagejs/level parses level data it is handed; reading the file is the caller's job.",
            },
          ],
        },
      ],
    },
  },
);

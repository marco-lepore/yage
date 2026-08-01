import { existsSync, renameSync } from "node:fs";
import path from "node:path";
import { normalizePath, type Plugin } from "vite";
import { renderEntryModule } from "./entryModule.js";
import { renderLabHtml } from "./labHtml.js";
import {
  DEFAULT_SCENARIO_GLOBS,
  resolveScenarioGlobs,
} from "./scenarioGlobs.js";

/**
 * Module id of the generated entry.
 *
 * Path-shaped rather than `virtual:`, so the page references it from a plain
 * `<script type="module">`. A `virtual:` id carries a null byte, which the HTML
 * would have to spell as `/@id/__x00__virtual:...`.
 */
export const LAB_ENTRY_ID = "/@yage-lab/entry.js";

/**
 * The name `yage-lab build` gives the page it builds. No such file exists —
 * the plugin claims the id and supplies the page from memory, so a build writes
 * nothing into the project.
 *
 * The name sits directly in the root because Vite derives the output path from
 * the input's path relative to the root, and it decides asset URLs from that
 * path's depth. A name one directory down would produce a page whose asset URLs
 * only work from that directory under a relative `base`. The built page is
 * renamed to `index.html` once written.
 */
export const LAB_BUILD_PAGE = ".yage-lab.html";

/** Probed in order when the harness path is not given. */
const HARNESS_CANDIDATES = [
  "lab/harness.ts",
  "lab/harness.mts",
  "lab/harness.js",
  "lab/harness.mjs",
] as const;

export interface YageLabOptions {
  /**
   * Glob patterns for scenario files, relative to the Vite root. Defaults to
   * every `*.scenario.ts` outside `node_modules` and `dist`.
   */
  scenarios?: readonly string[] | undefined;
  /**
   * The harness file, relative to the Vite root. Defaults to the first of
   * `lab/harness.ts`, `.mts`, `.js` and `.mjs` that exists.
   */
  harness?: string | undefined;
  /** Page title. */
  title?: string | undefined;
}

/** Root-absolute URL of a file inside the Vite root. */
function toRootUrl(root: string, file: string): string {
  const relative = path.relative(root, file).replace(/\\/g, "/");
  if (relative.startsWith("../")) {
    throw new Error(
      `The lab harness must live inside the Vite root. ${file} is outside ${root}.`,
    );
  }
  return `/${relative}`;
}

function findHarness(root: string, declared: string | undefined): string {
  if (declared !== undefined) {
    const file = path.resolve(root, declared);
    if (!existsSync(file)) {
      throw new Error(`No lab harness at ${file}.`);
    }
    return toRootUrl(root, file);
  }
  for (const candidate of HARNESS_CANDIDATES) {
    const file = path.join(root, candidate);
    if (existsSync(file)) return toRootUrl(root, file);
  }
  throw new Error(
    `No lab harness found. Create ${path.join(root, HARNESS_CANDIDATES[0])}, ` +
      "exporting `export default defineHarness({ engine, plugins })` from " +
      "@yagejs-tools/lab.",
  );
}

/**
 * Serves the lab page and generates the module behind it: the project's
 * harness, the scenarios the glob finds, and the call that mounts them.
 *
 * `yage-lab dev` and `yage-lab build` add it on top of the project's own Vite
 * config, so scenarios run under the same plugins and transforms the game
 * itself uses.
 *
 * It answers the dev server's root URL with the lab page, so a config carrying
 * this plugin serves the lab rather than the game.
 */
export function yageLab(options: YageLabOptions = {}): Plugin {
  const globs = resolveScenarioGlobs(
    options.scenarios ?? DEFAULT_SCENARIO_GLOBS,
  );
  const html = renderLabHtml({
    entryId: LAB_ENTRY_ID,
    ...(options.title !== undefined && { title: options.title }),
  });
  let harness = "";
  let buildPage = "";
  let builtPage = "";

  return {
    name: "yage-lab",
    // The entry id is not a real file, so it has to be claimed before Vite's
    // own resolver reports it missing.
    enforce: "pre",

    configResolved(config) {
      harness = findHarness(config.root, options.harness);
      buildPage = normalizePath(path.resolve(config.root, LAB_BUILD_PAGE));
      builtPage =
        config.command === "build"
          ? path.resolve(config.root, config.build.outDir, LAB_BUILD_PAGE)
          : "";
    },

    resolveId(id) {
      if (id === LAB_ENTRY_ID) return LAB_ENTRY_ID;
      return normalizePath(id) === buildPage ? buildPage : null;
    },

    load(id) {
      if (id === buildPage) return html;
      if (id !== LAB_ENTRY_ID) return null;
      return renderEntryModule({
        harness,
        patterns: globs.patterns,
        root: globs.root,
      });
    },

    /**
     * The staged page ships as `index.html`, so the output is publishable.
     *
     * Renamed on disk rather than in the bundle: the built page is not a
     * bundle entry a `generateBundle` hook can rewrite. Both names sit at the
     * top of the output directory, so relative asset URLs inside the page stay
     * correct.
     */
    closeBundle() {
      // Also called when a dev server closes, where there is nothing to rename.
      if (!builtPage || !existsSync(builtPage)) return;
      renameSync(builtPage, path.join(path.dirname(builtPage), "index.html"));
    },

    configureServer(server) {
      const base = server.config.base;
      // The project's own headers, because a game served under
      // cross-origin-isolation headers has to reach the lab under them too.
      const headers = server.config.server.headers ?? {};
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        if (url !== base && url !== `${base}index.html` && url !== "/") {
          next();
          return;
        }
        server
          .transformIndexHtml(req.url ?? "/", html, req.originalUrl)
          .then(
            (page) => {
              for (const [name, value] of Object.entries(headers)) {
                if (value !== undefined) res.setHeader(name, value);
              }
              res.setHeader("Content-Type", "text/html");
              res.setHeader("Cache-Control", "no-cache");
              res.end(page);
            },
            (error: unknown) => {
              next(error);
            },
          );
      });
    },
  };
}

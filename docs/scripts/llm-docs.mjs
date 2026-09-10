/**
 * Maps each docs page to the LLM Markdown reference covering the same ground.
 *
 * Shared by the Starlight route middleware (which emits the
 * `<link rel="alternate" type="text/markdown">` tag), the drift test, and the
 * post-build check, so the mapping lives in one place.
 *
 * Paths returned are site-absolute, as served from `public/` after
 * `copy-llms.mjs` runs: `/llms/<doc>.md`, `/llms/packages/<pkg>.md`,
 * `/llms/addons/<addon>.md`, `/llms/tools/<tool>.md`.
 */
import { join } from "node:path";

/** Site-absolute path of the agent index. */
export const LLMS_INDEX = "/llms.txt";

/** Package groups that author their own docs under `packages/<group>/<name>/docs/llms/`. */
export const GROUPS = ["addons", "tools"];

/**
 * Pages whose URL does not encode the covering reference. Keyed by route id
 * (the page path without leading slash or `/index`), value is a served path.
 */
const EXPLICIT = {
  "getting-started/installation": "/llms/quick-start.md",
  "getting-started/your-first-game": "/llms/quick-start.md",
  "guides/rendering": "/llms/packages/renderer.md",
  "guides/lighting": "/llms/packages/lighting.md",
  "guides/input": "/llms/packages/input.md",
  "guides/processes-and-tweens": "/llms/core-concepts.md",
  "guides/physics": "/llms/packages/physics.md",
  "guides/audio": "/llms/packages/audio.md",
  "guides/particles": "/llms/packages/particles.md",
  "guides/tilemaps": "/llms/packages/tilemap.md",
  "guides/levels": "/llms/packages/level.md",
  "guides/pathfinding": "/llms/packages/pathfinding.md",
  "guides/ui": "/llms/packages/ui.md",
  "guides/ui-react": "/llms/packages/ui-react.md",
  "guides/save-and-load": "/llms/packages/save.md",
  "guides/assets": "/llms/assets.md",
  "guides/loading-scene": "/llms/loading-scene.md",
  "guides/scene-transitions": "/llms/scene-transitions.md",
  "guides/debug": "/llms/packages/debug.md",
  "guides/play-sessions": "/llms/play-sessions.md",
  "tooling/scenario-lab": "/llms/tools/lab.md",
  "tooling/level-editor": "/llms/tools/editor.md",
  "tooling/feedback": "/llms/tools/feedback.md",
  "tooling/local-engine": "/llms/local-engine.md",
};

/**
 * Resolve a page's Markdown counterpart, or `null` when the page has none.
 *
 * `id` is the Starlight route id: `""` for the site root, `"addons"` for
 * `addons/index.mdx`, `"guides/physics"`, or a generated API page such as
 * `"api/yagejs/core/classes/entity"`. A `null` means the page only gets the
 * `describedby` link to the index. Returning a path does not guarantee the
 * file exists; callers check that against `public/` or `dist/`.
 */
export function resolveLlmDoc(id) {
  const route = id.replace(/^\/+|\/+$/g, "").replace(/\/index$/, "");
  if (route === "" || route === "index") return null;
  if (route in EXPLICIT) return EXPLICIT[route];

  const [head, second, third] = route.split("/");
  if (head === "concepts" && second) return "/llms/core-concepts.md";
  if (head === "patterns" && second) return "/llms/patterns.md";
  // Sub-pages of a guide (guides/rendering/camera) share the guide's reference.
  if (head === "guides" && second && third) {
    return EXPLICIT[`guides/${second}`] ?? null;
  }
  if (head === "addons")
    return second ? `/llms/addons/${second}.md` : "/llms/addons.md";
  // Generated API reference: api/yagejs/<pkg>/..., api/yagejs-tools/<tool>/...
  if (head === "api" && second && third) {
    if (second === "yagejs") return `/llms/packages/${third}.md`;
    if (second === "yagejs-tools") return `/llms/tools/${third}.md`;
    if (second === "yagejs-addons") return `/llms/addons/${third}.md`;
  }
  return null;
}

/**
 * Where a served path is authored, relative to the repository root.
 * Top-level and package docs live in `docs/llms/`; addon and tool docs are
 * co-located with their package and copied in by `copy-llms.mjs`.
 */
export function llmDocSource(servedPath) {
  const rel = servedPath.replace(/^\/llms\//, "");
  const [group, file] = rel.split("/");
  if (file && GROUPS.includes(group)) {
    return join(
      "packages",
      group,
      file.replace(/\.md$/, ""),
      "docs",
      "llms",
      file,
    );
  }
  return join("docs", "llms", rel);
}

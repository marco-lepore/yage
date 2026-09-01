import { Engine, Scene, type AssetHandle } from "@yagejs/core";
import {
  buildLevelCatalog,
  instantiateLevel,
  levelAssets,
  loadLevelDocument,
  prepareLevel,
  type PreparedLevel,
} from "@yagejs/level";
import { RendererPlugin } from "@yagejs/renderer";
import { exposeLevelFacts } from "./inspect.js";
import levelProject from "./levelProject.js";

const SAVED_LEVEL = "/levels/forest.yage-level.json";

class ForestScene extends Scene {
  readonly name = "forest";
  readonly preload: readonly AssetHandle<unknown>[];
  private readonly forest: PreparedLevel;

  constructor(forest: PreparedLevel) {
    super();
    this.forest = forest;
    this.preload = levelAssets(forest);
  }

  onEnter(): void {
    instantiateLevel(this, this.forest, { namespace: "forest" });
  }
}

async function main(): Promise<void> {
  const built = buildLevelCatalog(levelProject);
  if (!built.ok) {
    throw new Error(
      `The level catalog did not build: ${built.errors
        .map((error) => error.message)
        .join(" ")}`,
    );
  }

  const forest = prepareLevel(
    await loadLevelDocument(levelUrl()),
    built.catalog,
  );
  const container = document.getElementById("game-container");
  if (!container) throw new Error("#game-container is missing.");

  const engine = new Engine({ debug: true });
  exposeLevelFacts(engine);
  engine.use(
    new RendererPlugin({
      width: 960,
      height: 600,
      backgroundColor: 0x0f172a,
      container,
    }),
  );
  await engine.start();
  await engine.scenes.push(new ForestScene(forest));
}

/**
 * The level this page runs: the draft revision the editor's Run control named,
 * or the file on disk.
 *
 * A shipped game imports its level (`import raw from "./forest.yage-level.json"`).
 * This one fetches it because the E2E path writes that file during the run, and
 * a static import would serve whatever Vite transformed before the write.
 */
function levelUrl(): string {
  const params = new URLSearchParams(location.search);
  // `level` is what the editor's Run control names; `file` is this suite's
  // own, because each test writes a level of its own.
  return (
    sameOrigin(params.get("level")) ??
    sameOrigin(params.get("file")) ??
    SAVED_LEVEL
  );
}

/**
 * `url` when it names a file on this server, otherwise `undefined`.
 *
 * Resolved against this page, so the editor can name a level by its path
 * inside the project and it lands beside the page however the server is
 * based. This page loads a level out of its own project, and `//example.com/x`
 * resolves to another host.
 */
function sameOrigin(url: string | null): string | undefined {
  if (url === null || url === "") return undefined;
  const resolved = new URL(url, location.href);
  return resolved.origin === location.origin ? resolved.pathname : undefined;
}

void main().catch((error: unknown) => {
  const line = document.createElement("pre");
  line.id = "game-error";
  line.style.color = "#fca5a5";
  line.textContent = error instanceof Error ? error.message : String(error);
  document.body.append(line);
});

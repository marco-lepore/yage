import { levelAssets, prepareLevel } from "@yagejs/level";
import type { Engine } from "@yagejs/core";
import type { LayerDef } from "@yagejs/renderer";
import { EditorApiClient } from "../api/index.js";
import { LayerSets } from "../layers.js";
import { asHarness } from "../preview/index.js";
import { ProjectCoordinator } from "../project/index.js";
import { PlayScene } from "./PlayScene.js";

/** The query parameter naming the level to play. */
export const PLAY_LEVEL_PARAM = "level";

export interface MountPlayOptions {
  /** The element the renderer mounts into. */
  readonly host: HTMLElement;
  /** The per-process project token the page was served with. */
  readonly token: string;
  /** The project module's default export, validated here. */
  readonly project: unknown;
  /** The harness module's default export, validated here. */
  readonly harness: unknown;
  /** One entry per package that contributes level entities. */
  readonly contributions: readonly unknown[];
  /** One `LayerDef[]` per `levels` entry in the config that named a module. */
  readonly layerSets?: readonly (readonly LayerDef[])[] | undefined;
  /** Which level to play. Defaults to the page's own `level` parameter. */
  readonly level?: string | undefined;
}

export interface PlayHandle {
  /** Stop the engine and release what it holds. */
  dispose(): Promise<void>;
}

/**
 * Run the level the editor is holding, live, in the project's own harness.
 *
 * It reads the draft rather than the file, so what plays is what is on screen
 * in the editor, saved or not. Everything it needs — the engine, the plugins,
 * the entity declarations — comes from the modules the project already gives
 * the editor, so a project needs no code for this page to work.
 *
 * What it cannot show is whatever the game's own start-up does: its scene,
 * its systems, the state that decides when a level is entered. That is what
 * the Run control is for, and both documentation surfaces say so.
 */
export async function mountPlay(
  options: MountPlayOptions,
): Promise<PlayHandle> {
  const level = options.level ?? levelFromLocation();
  if (level === undefined || level === "") {
    throw new Error(
      `This page plays the level named in its "${PLAY_LEVEL_PARAM}" parameter, ` +
        `and none was given. Open it with the editor's Play control.`,
    );
  }

  const api = new EditorApiClient({ token: options.token });
  const layers = new LayerSets(options.layerSets ?? []);
  const outcome = await api.fetchSnapshot(level);
  if (outcome.status === "rejected") {
    throw new Error(`${level} could not be read: ${outcome.message}`);
  }

  const project = new ProjectCoordinator();
  const built = project.initialize({
    project: options.project,
    contributions: options.contributions,
  });
  if (!built.ok) {
    throw new Error(
      built.diagnostics.map((diagnostic) => diagnostic.message).join(" "),
    );
  }

  const prepared = prepareLevel(outcome.snapshot.document, built.catalog);
  if (prepared.diagnostics.length > 0) {
    // Unlike the editor's preview, which draws what it can and reports the
    // rest, this page has nothing to show for a level that will not load. A
    // partial run would answer the question it exists to answer wrongly.
    throw new Error(
      prepared.diagnostics
        .map((diagnostic) => `${diagnostic.placementId}: ${diagnostic.message}`)
        .join("\n"),
    );
  }

  const harness = asHarness(options.harness);
  if (!harness) {
    throw new Error(
      "The harness module's default export is not a harness. Export " +
        "{ engine, plugins } from it.",
    );
  }

  const engine: Engine = harness.engine();
  for (const plugin of harness.plugins({ container: options.host })) {
    engine.use(plugin);
  }
  await engine.start();
  try {
    await engine.assets.loadAll(levelAssets(prepared));
    await engine.scenes.push(
      new PlayScene(prepared, layers.defsFor(outcome.snapshot.layerSet)),
    );
  } catch (failure) {
    // A level naming an asset that will not load is an ordinary state while
    // editing. The engine is running by this point and the caller never
    // receives the handle that would stop it, so it is stopped here rather
    // than left ticking behind the message the page shows instead.
    await engine.destroy();
    throw failure;
  }

  return {
    async dispose(): Promise<void> {
      await engine.destroy();
    },
  };
}

function levelFromLocation(): string | undefined {
  return (
    new URLSearchParams(window.location.search).get(PLAY_LEVEL_PARAM) ??
    undefined
  );
}

import type { SnapshotContributor } from "@yagejs/save";
import type { EffectStackSnapshot } from "./EffectStack.js";
import type { EffectsHost } from "./EffectsHost.js";
import type { SceneRenderTreeProviderImpl } from "../SceneRenderTreeProvider.js";
import type { SceneTreesSnapshot } from "../SceneRenderTreeProvider.js";

/**
 * Snapshot data emitted by the renderer's contributor. Mirrors the runtime
 * topology — one screen-scope stack and a per-scene record of tree-scope
 * effects, layer-scope effects, and masks at both levels.
 */
export interface RendererSnapshotData {
  /** Screen-scope effects on `app.stage`. Cross-scene by design. */
  screen?: EffectStackSnapshot;
  /** One entry per scene in `sceneManager.all`, in stack order. */
  scenes: SceneTreesSnapshot;
}

/**
 * Bridges the layer/scene/screen-scope effect + mask state into the save
 * system. Registered by `RendererPlugin.install` against `SaveService` if
 * `@yagejs/save` is installed and the service is available.
 *
 * Per-component effects/masks are NOT covered here — those serialize through
 * the visual components' own `serialize()` / `afterRestore` hooks.
 *
 * @internal
 */
export class RendererSnapshotContributor implements SnapshotContributor {
  constructor(
    private readonly provider: SceneRenderTreeProviderImpl,
    private readonly screenFx: () => EffectsHost,
  ) {}

  serialize(): RendererSnapshotData | undefined {
    const scenes = this.provider.serializeAll();
    const screen = this.screenFx().serialize();
    const hasScene = scenes.some(
      (s) => s.tree || s.layers || s.mask || s.layerMasks,
    );
    if (!screen && !hasScene) return undefined;
    return {
      ...(screen ? { screen } : {}),
      scenes,
    };
  }

  restore(data: unknown): void {
    // `data === undefined` means "no renderer extras in this snapshot" —
    // we still need to clear any baseline state (e.g. a screen-scope
    // effect enabled after the save was taken) so Load returns to the
    // saved configuration rather than overlaying it on the live state.
    let snap: RendererSnapshotData;
    if (data === undefined) {
      snap = { scenes: [] };
    } else if (isRendererSnapshot(data)) {
      snap = data;
    } else {
      // A non-undefined payload that fails the type guard is a corrupt or
      // older renderer extras blob. Leaving it to the empty-snapshot path
      // would silently wipe live state with no diagnostic — warn and bail.
      console.warn(
        "RendererSnapshotContributor: ignoring malformed renderer snapshot payload.",
      );
      return;
    }

    // Always reset the screen stack to match the snapshot. If the
    // snapshot has no screen entry, restoreFrom an empty list clears
    // every screen-scope effect; we only allocate a stack here if one
    // already exists — otherwise there's nothing to clear.
    const screenFx = this.screenFx();
    if (snap.screen) {
      screenFx.restore(snap.screen);
    } else if (screenFx.size > 0) {
      screenFx.restore({ entries: [] });
    }

    this.provider.restoreAll(snap.scenes);
  }
}

function isRendererSnapshot(data: unknown): data is RendererSnapshotData {
  return (
    typeof data === "object" &&
    data !== null &&
    Array.isArray((data as RendererSnapshotData).scenes)
  );
}

import { Scene } from "@yagejs/core";
import type { AssetHandle } from "@yagejs/core";
import type { LayerDef } from "@yagejs/renderer";

/**
 * The blank scene a `setup` scenario builds into. Scenarios that mount a
 * `Scene` the game already has never reach this class.
 */
export class ScenarioScene extends Scene {
  readonly name: string;
  readonly layers: readonly LayerDef[];
  readonly preload: readonly AssetHandle<unknown>[];

  constructor(
    name: string,
    private readonly build: (scene: Scene) => void,
    layers: readonly LayerDef[] | undefined,
    preload: readonly AssetHandle<unknown>[] | undefined,
  ) {
    super();
    this.name = name;
    this.layers = layers ?? [];
    this.preload = preload ?? [];
  }

  onEnter(): void {
    this.build(this);
  }
}

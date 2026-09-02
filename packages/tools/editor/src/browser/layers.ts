import type { LayerDef } from "@yagejs/renderer";

/** A layer a placement can be put on, as the shell shows it. */
export interface LayerChoice {
  readonly name: string;
  /**
   * Whether the layer decides its own draw order every frame. Sibling order in
   * the document changes nothing on a layer that does, so the ordering
   * controls say why instead of reordering it.
   */
  readonly sorted: boolean;
}

/**
 * The layer sets the page imported, in the order the editor config listed the
 * `levels` entries that named them.
 *
 * A level says which one it belongs to through the `layerSet` on its draft
 * snapshot: the server matched the globs once, so neither page matches them
 * again. An index nothing answers to — an older server, a level whose glob
 * named no layers — reads as no declared layers, which is what a level could
 * say before layers were authorable.
 */
export class LayerSets {
  constructor(private readonly sets: readonly (readonly LayerDef[])[]) {}

  /** What the preview provisions for a level, and the play page declares. */
  defsFor(index: number | undefined): readonly LayerDef[] {
    return (index === undefined ? undefined : this.sets[index]) ?? [];
  }

  /**
   * What the inspector offers for a level.
   *
   * Screen-space layers are left out: a camera skips them when it binds
   * automatically, so a placement's world transform would be read as raw
   * screen pixels there. So is `default`, which is what a placement with no
   * authored layer already draws on.
   */
  choicesFor(index: number | undefined): readonly LayerChoice[] {
    return this.defsFor(index)
      .filter((def) => def.space !== "screen" && def.name !== "default")
      .map((def) => ({ name: def.name, sorted: def.sort !== undefined }));
  }

  /**
   * Whether the layer a placement draws on keys its own draw order, which is
   * what makes reordering it among its siblings change nothing on screen.
   */
  sorted(index: number | undefined, layer: string | undefined): boolean {
    const name = layer ?? "default";
    return this.defsFor(index).some(
      (def) => def.name === name && def.sort !== undefined,
    );
  }
}

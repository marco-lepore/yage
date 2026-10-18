import type { TextureResource } from "../public-types.js";
import type { ResolvedMaps } from "./resolveMaps.js";

/** Frame views shared by a controller and its active sprite; never owns images. */
export class ResolvedSpriteSource {
  private owners = 1;

  constructor(
    readonly frames: TextureResource[],
    readonly maps: ResolvedMaps,
    private readonly ownsFrames: boolean,
  ) {}

  retain(): void {
    this.owners++;
  }
  release(): void {
    if (--this.owners !== 0 || !this.ownsFrames) return;
    for (const frame of this.frames) frame.destroy(false);
  }
}

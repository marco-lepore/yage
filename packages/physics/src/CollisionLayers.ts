/** Maximum number of collision layers supported. */
const MAX_LAYERS = 16;

/**
 * Manages named collision layers as bitmasks.
 *
 * Each layer is assigned a sequential power of 2 (1, 2, 4, 8, …).
 * Use `interactionGroups()` to pack membership + filter masks
 * into Rapier's 32-bit InteractionGroups format.
 */
export class CollisionLayers {
  private layers = new Map<string, number>();
  private nextBit = 0;

  /** Define a new named layer. Returns its bitmask. */
  define(name: string): number {
    if (this.layers.has(name)) {
      throw new Error(`Collision layer "${name}" is already defined.`);
    }
    if (this.nextBit >= MAX_LAYERS) {
      throw new Error(
        `Cannot define more than ${MAX_LAYERS} collision layers.`,
      );
    }
    const mask = 1 << this.nextBit;
    this.layers.set(name, mask);
    this.nextBit++;
    return mask;
  }

  /** Look up a layer bitmask by name. Throws if not defined. */
  get(name: string): number {
    const mask = this.layers.get(name);
    if (mask === undefined) {
      throw new Error(`Collision layer "${name}" is not defined.`);
    }
    return mask;
  }

  /** Combine multiple named layers into a single bitmask (bitwise OR). */
  combine(...names: string[]): number {
    let result = 0;
    for (const name of names) {
      result |= this.get(name);
    }
    return result;
  }

  /**
   * Pack membership and filter bitmasks into Rapier's InteractionGroups format.
   * The upper 16 bits are the membership, the lower 16 bits are the filter.
   */
  static interactionGroups(membership: number, filter: number): number {
    return ((membership & 0xffff) << 16) | (filter & 0xffff);
  }
}

import { createRandom } from "../random.js";
/** Seeded DSP draws use the same generator as patches and preset variation. */
export class Rng {
  readonly next: () => number;
  constructor(seed: number) {
    this.next = createRandom(seed);
  }
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
}

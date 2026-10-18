import { Entity, Transform, Vec2 } from "@yagejs/core";
import { LightSource, LightingWorldKey } from "@yagejs/lighting";
import { CaseProbe } from "../probe.js";
import type { CaseReading } from "../probe.js";

/** Where the lamp stands, in world pixels. */
const LIGHT_AT = new Vec2(480, 180);
/** A point the lamp does not reach. */
const FAR_FROM_LIGHT = new Vec2(40, 40);

/** What the lighting case reports. */
export interface LightingReading extends CaseReading {
  levelAtLight: number;
  levelFar: number;
  frames: number;
}

/** Reads the light level the lighting world reports at two world points. */
export class LightingProbe extends CaseProbe {
  private readonly world = this.service(LightingWorldKey);
  private frames = 0;

  update(): void {
    this.frames += 1;
  }

  get settled(): boolean {
    return this.frames >= 2;
  }

  reading(): LightingReading {
    return {
      levelAtLight: this.world.levelAt(LIGHT_AT.x, LIGHT_AT.y),
      levelFar: this.world.levelAt(FAR_FROM_LIGHT.x, FAR_FROM_LIGHT.y),
      frames: this.frames,
    };
  }
}

/** One radial light over the ambient level the engine starts with. */
export class LightingCase extends Entity {
  setup(): void {
    this.add(new Transform({ position: LIGHT_AT }));
    this.add(new LightSource({ radius: 120 }));
    this.add(new LightingProbe());
  }
}

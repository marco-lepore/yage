import { Entity, Transform, Vec2 } from "@yagejs/core";
import { InputManagerKey } from "@yagejs/input";
import { CaseProbe } from "../probe.js";
import type { CaseReading } from "../probe.js";

/** Where the last pointer press landed, in virtual pixels. */
export interface PointerReading {
  x: number;
  y: number;
  type: string;
}

/** What the input case reports. */
export interface InputReading extends CaseReading {
  jumpPresses: number;
  lastPointer: PointerReading | null;
}

/** Counts presses of the `jump` action and keeps the last pointer press. */
export class InputProbe extends CaseProbe {
  private readonly input = this.service(InputManagerKey);
  private jumpPresses = 0;
  private lastPointer: PointerReading | null = null;

  onAdd(): void {
    this.addCleanup(
      this.input.onPointerDown((info) => {
        this.lastPointer = {
          x: info.screenPos.x,
          y: info.screenPos.y,
          type: info.type,
        };
      }),
    );
  }

  update(): void {
    if (this.input.isJustPressed("jump")) this.jumpPresses += 1;
  }

  get settled(): boolean {
    return true;
  }

  reading(): InputReading {
    return { jumpPresses: this.jumpPresses, lastPointer: this.lastPointer };
  }
}

/** Keyboard and pointer input, read through the action map. */
export class InputCase extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(320, 300) }));
    this.add(new InputProbe());
  }
}

import { Component, defineEvent } from "@yagejs/core";
import { assertInteger } from "./core/geometry.js";
import type {
  GenerationInspection,
  GenerationJob,
  GenerationStatus,
} from "./core/types.js";

export const GenerationFinishedEvent = defineEvent<{
  readonly status: Exclude<GenerationStatus, "running">;
}>("procedural:finished");

/** Incremental search on a host entity. Disable pauses; removal cancels unfinished work. */
export class GenerationController<
  T extends GenerationJob = GenerationJob,
> extends Component {
  static override readonly inspectExclude = [
    "generator",
    "operationsPerUpdate",
    "reported",
  ];
  private reported = false;
  constructor(
    readonly generator: T,
    readonly operationsPerUpdate = 256,
  ) {
    super();
    assertInteger(
      "GenerationController operationsPerUpdate",
      operationsPerUpdate,
      1,
      10_000_000,
    );
  }
  get generation(): GenerationInspection {
    return this.generator.inspect();
  }
  update(): void {
    this.generator.step(this.operationsPerUpdate);
    if (!this.reported && this.generator.status !== "running") {
      this.reported = true;
      this.entity.emit(GenerationFinishedEvent, {
        status: this.generator.status,
      });
    }
  }
  onDestroy(): void {
    this.generator.cancel();
  }
}

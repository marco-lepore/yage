import type { DebugContributor, HudDebugApi } from "../types.js";
import type { Inspector } from "@yagejs/core";

export class EntityCountContributor implements DebugContributor {
  readonly name = "entities";
  readonly flags: readonly string[] = [];

  constructor(private readonly inspector: Inspector) {}

  drawHud(api: HudDebugApi): void {
    const count = this.inspector.snapshot().entityCount;
    api.addLine(`Entities: ${count}`);
  }
}

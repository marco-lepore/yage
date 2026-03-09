import type { DebugContributor, StatsApi, HudDebugApi } from "../types.js";

export class FpsContributor implements DebugContributor {
  readonly name = "fps";
  readonly flags: readonly string[] = [];
  private stats: StatsApi | null = null;

  sample(stats: StatsApi, dt: number): void {
    this.stats = stats;
    if (dt > 0) stats.push("fps", 1000 / dt);
  }

  drawHud(api: HudDebugApi): void {
    const avg = this.stats?.average("fps") ?? 0;
    api.addLine(`FPS: ${Math.round(avg)}`);
  }
}

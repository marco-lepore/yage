import type { DebugContributor, StatsApi, HudDebugApi } from "../types.js";

export class SystemTimingContributor implements DebugContributor {
  readonly name = "timing";
  readonly flags = ["breakdown"] as const;
  private stats: StatsApi | null = null;

  constructor(private readonly timings: Map<string, number>) {}

  sample(stats: StatsApi): void {
    this.stats = stats;
    for (const [name, ms] of this.timings) {
      stats.push(`system.${name}`, ms);
    }
  }

  drawHud(api: HudDebugApi): void {
    if (!this.stats) return;

    let total = 0;
    const entries: Array<[string, number]> = [];
    for (const name of this.timings.keys()) {
      const avg = this.stats.average(`system.${name}`);
      total += avg;
      entries.push([name, avg]);
    }

    api.addLine(`Systems: ${total.toFixed(2)}ms`);

    if (api.isFlagEnabled("breakdown")) {
      entries.sort((a, b) => b[1] - a[1]);
      for (const [name, avg] of entries) {
        api.addLine(`  ${name}: ${avg.toFixed(2)}ms`);
      }
    }
  }
}

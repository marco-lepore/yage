import { Component, Entity, Transform, Vec2 } from "@yagejs/core";
import { TextComponent } from "@yagejs/renderer";
import { HUD_LAYER, WIDTH } from "./constants.js";
import type { Explorer } from "./explorer.js";
import type { MapMode, MapState } from "./map.js";

const TITLES: Record<MapMode, string> = {
  dungeon: "DUNGEON",
  catalog: "CATALOG MAP",
  cave: "CAVE",
  "small-budget": "SMALL BUDGET",
  impossible: "IMPOSSIBLE BOUNDS",
};
const DESCRIPTIONS: Record<MapMode, string> = {
  dungeon:
    "15 rooms from requirements · shops never touch the forge · the boss needs both treasure keys",
  catalog:
    "The same graph and rules with nothing placed: the game decides where each region goes",
  cave: "A cellular cave: one connected floor area, no room catalog",
  "small-budget": "A 10-step budget for fifteen rooms",
  impossible: "Bounds that hold only the entrance room, so no other room fits",
};
const CONTROLS = [
  "1 dungeon · 2 catalog map · 3 cave · R new seed · B small budget · U impossible bounds",
  "TAB next target · SPACE walk there · ARROWS step",
].join("\n");

// ---------------------------------------------------------------------------
// HudText — what the map holds and what the explorer is doing
// ---------------------------------------------------------------------------

export class HudText extends Component {
  private readonly text = this.sibling(TextComponent);
  private shown = "";
  constructor(
    private readonly map: MapState,
    private readonly explorer: Explorer,
  ) {
    super();
  }

  update(): void {
    const next = [
      this.headline(),
      DESCRIPTIONS[this.map.mode],
      this.details(),
      this.progress(),
      CONTROLS,
    ]
      .filter((line) => line !== "")
      .join("\n");
    if (next === this.shown) return;
    this.shown = next;
    this.text.setText(next);
  }

  private headline(): string {
    const { mode, seed, status, steps } = this.map;
    const outcome =
      status === "running"
        ? `searching… ${steps} steps`
        : status === "succeeded"
          ? `found in ${steps} steps`
          : `${status} after ${steps} steps`;
    return `${TITLES[mode]} · seed ${seed} · ${outcome}`;
  }

  private details(): string {
    const { layout, selection, cave, status, diagnostics } = this.map;
    if (status !== "running" && status !== "succeeded") {
      // The last diagnostic says why the job stopped. An exhausted search
      // also keeps an example of each reason it rejected candidates.
      return (status === "exhausted" ? diagnostics : diagnostics.slice(-1))
        .map((d) => d.message)
        .join("\n");
    }
    const index = this.explorer.targetIndex;
    const region = layout?.regions[index] ?? selection?.regions[index];
    if (region) {
      const variant = region.variantId ? `/${region.variantId}` : "";
      const stock =
        typeof region.metadata["stock"] === "string"
          ? `, stock ${region.metadata["stock"]}`
          : "";
      const target = `Target: ${region.id} (${region.kind} → ${region.templateId}${variant}${stock})`;
      if (!layout) return target;
      const route = this.explorer.walking
        ? "walking"
        : this.explorer.blocked
          ? "locked until both keys are collected"
          : "SPACE walks there";
      return `${target} · ${route}`;
    }
    if (cave)
      return `${cave.cells[0]!.length} × ${cave.cells.length} tiles · SPACE walks to the marked tile`;
    return "";
  }

  private progress(): string {
    const { layout } = this.map;
    if (!layout) return "";
    const { keys, visited } = this.map.summary;
    return `Keys: ${keys.join(", ") || "none"} · rooms visited ${visited.length} / ${layout.regions.length} · dark rooms are locked`;
  }
}

/** Status text in the top-left corner, on the screen-space HUD layer. */
export class HudEntity extends Entity {
  setup(params: { map: MapState; explorer: Explorer }): void {
    this.add(new Transform({ position: new Vec2(24, 16) }));
    this.add(
      new TextComponent({
        layer: HUD_LAYER,
        text: "",
        style: {
          fontFamily: "monospace",
          fontSize: 13,
          fill: 0xdce8f5,
          lineHeight: 22,
          wordWrap: true,
          wordWrapWidth: WIDTH - 48,
        },
      }),
    );
    this.add(new HudText(params.map, params.explorer));
  }
}

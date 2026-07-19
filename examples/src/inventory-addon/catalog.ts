import { defineItems, type ItemActionDef, type ItemDef } from "@yagejs-addons/inventory";
import { Texture } from "pixi.js";
import { ICON_POTION } from "./constants.js";

// ── the item catalog — ids are the map keys, typed end to end ────────────────

export const CATALOG = defineItems({
  potion: {
    name: "Potion",
    description: "Restores 25 HP. Stacks to 5.",
    category: "consumable",
    maxStack: 5,
    icon: ICON_POTION, // the one texture-backed icon (canvas-drawn, no assets)
    actions: ["use", "drop", "examine"],
  },
  elixir: {
    name: "Elixir",
    description: "Restores all HP. Rare.",
    category: "consumable",
    maxStack: 3,
    color: 0xd8a0ff,
    actions: ["use", "drop", "examine"],
  },
  gem: {
    name: "Gem",
    description: "Sparkles. Piles up to 99 in one slot.",
    category: "treasure",
    maxStack: 99,
    color: 0x7ec8ff,
    actions: ["drop", "examine"],
  },
  arrows: {
    name: "Arrows",
    description: "Quiver-capped: at most 30 in the whole bag.",
    category: "ammo",
    maxStack: 30,
    stacking: "single", // ONE capped stack — extra arrows are rejected
    color: 0x98e698,
    actions: ["drop", "examine"],
  },
  sword: {
    name: "Iron Sword",
    description: "A dependable blade.",
    category: "gear",
    color: 0xc9c9de,
    actions: ["equip", "unequip", "drop", "examine"],
  },
  shield: {
    name: "Oak Shield",
    description: "Sturdy enough.",
    category: "gear",
    color: 0xffa07a,
    actions: ["equip", "unequip", "drop", "examine"],
  },
  goldKey: {
    name: "Gold Key",
    description: "Opens the vault door.",
    category: "key",
    color: 0xffd866,
    actions: ["examine"],
  },
  oldMap: {
    name: "Old Map",
    description: "Someone circled the vault.",
    category: "key",
    color: 0xe8c9a0,
    actions: ["examine"],
  },
});

export type ItemId = Parameters<typeof CATALOG.get>[0];

/** Shared demo state the components and action handlers read/write. */
export interface DemoState {
  hp: number;
  equipped: ItemId | null;
  potions: number;
  lastToast: string;
}

/** Whether an item offers the "use" action — the hotbar's filter (only
 *  potions/elixirs are usable; gear, treasure, and key items are excluded
 *  from the strip entirely rather than shown inert). */
export function isUsable(_stack: unknown, def: ItemDef<ItemId>): boolean {
  return def.actions?.includes("use") ?? false;
}

// ── item actions: labels + availability injected as policy ───────────────────

export function itemActions(state: DemoState): ItemActionDef<ItemId>[] {
  return [
    { id: "use", label: "Use", consumes: true },
    {
      id: "equip",
      label: "Equip",
      available: (ctx) => state.equipped !== ctx.stack.itemId,
    },
    {
      id: "unequip",
      label: "Unequip",
      available: (ctx) => state.equipped === ctx.stack.itemId,
    },
    {
      id: "drop",
      label: "Drop",
      consumes: true,
      // Can't drop what you're wielding.
      available: (ctx) => state.equipped !== ctx.stack.itemId,
    },
    { id: "examine", label: "Examine" },
  ];
}

// ── canvas-drawn potion icon (the zero-asset icon path) ──────────────────────

export function makePotionIcon(): Texture {
  const s = 48;
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#ff5566";
    ctx.beginPath();
    ctx.arc(s / 2, s * 0.62, s * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#d8dae8";
    ctx.fillRect(s * 0.42, s * 0.12, s * 0.16, s * 0.24);
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s / 2, s * 0.62, s * 0.3, 0, Math.PI * 2);
    ctx.stroke();
  }
  return Texture.from(canvas);
}

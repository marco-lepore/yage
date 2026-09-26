import {
  defineItems,
  type ItemActionDef,
  type ItemDef,
} from "@yagejs-addons/inventory";
import type { GraphicsContext } from "@yagejs/renderer";
import { ICON_POTION } from "./constants.js";

// ── the item catalog — ids are the map keys, typed end to end ────────────────

export const CATALOG = defineItems({
  potion: {
    name: "Potion",
    description: "Restores 25 HP. Stacks to 5.",
    category: "consumable",
    maxStack: 5,
    icon: ICON_POTION, // the one texture icon; main.ts draws it at boot
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

/** Whether an item offers the "use" action: the hotbar's filter. Only
 *  potions and elixirs qualify; gear, treasure and key items stay off the
 *  strip instead of showing as inert cells. */
export function isUsable(_stack: unknown, def: ItemDef<ItemId>): boolean {
  return def.actions?.includes("use") ?? false;
}

// ── item actions: labels, plus availability that reads game state ───────────

/** The actions every item may offer. Equip, Unequip and Drop depend on what
 *  the player holds, which `equipped` reads. */
export function itemActions(
  equipped: () => ItemId | null,
): ItemActionDef<ItemId>[] {
  return [
    { id: "use", label: "Use", consumes: true },
    {
      id: "equip",
      label: "Equip",
      available: (ctx) => equipped() !== ctx.stack.itemId,
    },
    {
      id: "unequip",
      label: "Unequip",
      available: (ctx) => equipped() === ctx.stack.itemId,
    },
    {
      id: "drop",
      label: "Drop",
      consumes: true,
      // Can't drop what you're wielding.
      available: (ctx) => equipped() !== ctx.stack.itemId,
    },
    { id: "examine", label: "Examine" },
  ];
}

// ── the potion icon, drawn instead of loaded ─────────────────────────────────

/** Width and height of the potion icon texture, in pixels. */
export const POTION_ICON_SIZE = 48;

/** A red flask with a grey neck. `main.ts` bakes it into the texture the
 *  catalog's `icon` key names. */
export function drawPotionIcon(g: GraphicsContext): void {
  const s = POTION_ICON_SIZE;
  g.circle(s / 2, s * 0.62, s * 0.3).fill({ color: 0xff5566 });
  g.rect(s * 0.42, s * 0.12, s * 0.16, s * 0.24).fill({ color: 0xd8dae8 });
  g.circle(s / 2, s * 0.62, s * 0.3).stroke({
    color: 0xffffff,
    alpha: 0.75,
    width: 2,
  });
}

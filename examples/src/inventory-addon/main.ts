/**
 * Inventory addon example — a small scavenging room that exercises most of
 * `@yagejs-addons/inventory`:
 *
 *  • **Two inventories, two views** — the backpack (bounded, 5×3 GRID) and the
 *    key-items pouch (unbounded, autoCompact LIST that `accepts` only
 *    `category: "key"`); pickups route by category.
 *  • **Stacking logics** — potions merge into 5-stacks across cells ("multi"),
 *    arrows cap at one 30-stack ("single": the excess is rejected), gems pile
 *    to 99, gear doesn't stack.
 *  • **Partial acceptance** — a pickup only vanishes once the whole bundle
 *    fits; what didn't fit stays on the floor (`AddResult.added`), and a full
 *    backpack raises the "rejected" toast via `InventoryRejectedEvent`.
 *  • **Item actions with injected availability** — Use (consumes, heals),
 *    Equip/Unequip (availability depends on what the player holds), Drop
 *    (spawns the item back into the world), Examine — consequences applied
 *    in ONE `InventoryActionEvent` handler (`ItemConsequences`).
 *  • **Sorting** — R (while a panel is open) consolidates partial stacks and
 *    orders by catalog order.
 *  • **The model is always live** — the vault door consumes the gold key with
 *    both panels CLOSED (`keyItems.has/remove`), and the HUD potion counter
 *    tracks `InventoryItemAdded/RemovedEvent` as they happen.
 *  • **Icons** — the potion declares an `icon` texture (drawn with the
 *    renderer at boot, no asset file); everything else uses the colored-tile
 *    fallback.
 *  • **Interactive hotbar** — a chrome-less always-on strip shows a
 *    `filteredView` of the backpack: only items offering "use" (potions,
 *    elixirs), compacted, so the strip has no dead cells. Number keys 1–5
 *    `use` the matching cell, driven by a host component (not a panel
 *    binding) — the SAME mutation a click in the backpack panel makes, since
 *    it's one shared model underneath.
 *
 * Files:
 * - `constants.ts` — sizes, layers, spawn keys, events.
 * - `catalog.ts` — the item catalog, item actions and the potion icon.
 * - `bag.ts` — the bag entity: both inventories and the one-panel rule.
 * - `panels.ts` — the backpack and key-items panels, the hotbar, and the
 *   component that applies what item actions mean.
 * - `player.ts`, `room.ts`, `hud.ts` — the player, pickups and vault door,
 *   and the HUD.
 * - `scene.ts` — the `Scene` subclass; `onEnter` only spawns.
 * - `probe.ts` — Inspector-readable state for tests.
 *
 * Controls: WASD/arrows walk · E interact · I backpack · K key items ·
 * arrows/mouse navigate · E/Enter/click confirm · Esc close · R sort ·
 * 1–5 hotbar quick-use.
 */

import { Engine } from "@yagejs/core";
import { RendererPlugin, registerTexture } from "@yagejs/renderer";
import { InputPlugin } from "@yagejs/input";
import {
  installDebugFromUrl,
  setupGameContainer,
} from "../shared/bootstrap.js";
import { HEIGHT, ICON_POTION, WIDTH } from "./constants.js";
import { drawPotionIcon, POTION_ICON_SIZE } from "./catalog.js";
import { InventoryRoomScene } from "./scene.js";

// ── boot ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const engine = new Engine({ debug: true });
  const renderer = new RendererPlugin({
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: 0x0a0a0a,
    container: setupGameContainer(WIDTH, HEIGHT),
  });
  engine.use(renderer);
  engine.use(
    new InputPlugin({
      actions: {
        interact: ["KeyE", "Enter"],
        "move-up": ["ArrowUp", "KeyW"],
        "move-down": ["ArrowDown", "KeyS"],
        "move-left": ["ArrowLeft", "KeyA"],
        "move-right": ["ArrowRight", "KeyD"],
        cancel: ["Escape"],
        sort: ["KeyR"],
        inventory: ["KeyI"],
        "key-items": ["KeyK"],
        "quick-1": ["Digit1"],
        "quick-2": ["Digit2"],
        "quick-3": ["Digit3"],
        "quick-4": ["Digit4"],
        "quick-5": ["Digit5"],
      },
      preventDefaultKeys: [
        "Space",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
      ],
    }),
  );
  await installDebugFromUrl(engine);
  await engine.start();
  // The catalog names the potion's icon by key. Bake the drawing into a
  // texture once and register it under that key before any panel shows it.
  registerTexture(
    ICON_POTION,
    renderer.createTexture(drawPotionIcon, {
      width: POTION_ICON_SIZE,
      height: POTION_ICON_SIZE,
    }),
  );
  await engine.scenes.push(new InventoryRoomScene());
}

main().catch(console.error);

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
 *    Equip/Unequip (game-state-dependent availability), Drop (spawns the item
 *    back into the world), Examine — consequences applied in ONE
 *    `InventoryActionEvent` handler.
 *  • **Sorting** — R (while a panel is open) consolidates partial stacks and
 *    orders by catalog order.
 *  • **The model is always live** — the vault door consumes the gold key with
 *    both panels CLOSED (`keyItems.has/remove`), and the HUD potion counter
 *    tracks `InventoryItemAdded/RemovedEvent` in real time.
 *  • **Icons** — the potion declares an `icon` texture (drawn on a canvas at
 *    startup, zero assets); everything else uses the colored-tile fallback.
 *
 *  • **Interactive hotbar** — a chrome-less always-on strip shows a
 *    `filteredView` of the backpack: only items offering "use" (potions,
 *    elixirs), compacted, so the strip has no dead cells. Number keys 1–5
 *    `use` the matching cell, driven by a host component (not a panel
 *    binding) — the SAME mutation a click in the backpack panel makes, since
 *    it's one shared model underneath.
 *
 * Controls: WASD/arrows walk · E interact · I backpack · K key items ·
 * arrows/mouse navigate · E/Enter/click confirm · Esc close · R sort ·
 * 1–5 hotbar quick-use.
 */

import { Component, Engine, MathUtils, Scene, Transform, Vec2 } from "@yagejs/core";
import {
  CameraEntity,
  GraphicsComponent,
  RendererPlugin,
  TextComponent,
  type LayerDef,
} from "@yagejs/renderer";
import { InputManagerKey, InputPlugin } from "@yagejs/input";
import {
  INVENTORY_ACTIONS,
  defineItems,
  filteredView,
  inventoryControls,
  Inventory,
  InventoryActionEvent,
  InventoryController,
  InventoryItemAddedEvent,
  InventoryItemRemovedEvent,
  InventoryOpenedEvent,
  InventoryRejectedEvent,
  type InventorySource,
  type ItemActionDef,
  type ItemDef,
  type RejectReason,
} from "@yagejs-addons/inventory";
import {
  createInventoryPanel,
  defaultInventoryTheme,
  rowCell,
  INVENTORY_LAYERS,
} from "@yagejs-addons/inventory/presenters";
import { Assets, Texture } from "pixi.js";
import { installDebugFromUrl, setupGameContainer } from "./shared/bootstrap.js";

const WIDTH = 800;
const HEIGHT = 600;
const PLAYER_SPEED = 175;
const HOTBAR_SLOTS = 5;
/** Centered along the bottom, clear of the controls line beneath it. Sized so
 *  five ~52px cells show their icons unsquashed — paired with the reduced
 *  padding below (a chrome-less strip needs far less inset than a framed panel). */
const HOTBAR_BOUNDS = { x: (WIDTH - 300) / 2, y: HEIGHT - 90, width: 300, height: 66 };

const ROOM_LAYER = "room";
const HUD_LAYER = "hud";
const LAYERS: LayerDef[] = [
  { name: ROOM_LAYER, order: 10, space: "world" },
  ...INVENTORY_LAYERS,
  { name: HUD_LAYER, order: 1200, space: "screen" },
];

// ── the item catalog — ids are the map keys, typed end to end ────────────────

const ICON_POTION = "icon-potion";

const CATALOG = defineItems({
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

type ItemId = Parameters<typeof CATALOG.get>[0];

/** Shared demo state the components and action handlers read/write. */
interface DemoState {
  hp: number;
  equipped: ItemId | null;
  potions: number;
  lastToast: string;
}

// ── world components ──────────────────────────────────────────────────────────

/** WASD/arrow movement, frozen while any inventory panel is open (the same
 *  arrows navigate the panel then — host policy, one predicate). */
class PlayerMover extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly transform = this.sibling(Transform);

  constructor(private readonly isBusy: () => boolean) {
    super();
  }

  update(dt: number): void {
    if (this.isBusy()) return;
    const dx = this.input.getAxis("move-left", "move-right");
    const dy = this.input.getAxis("move-up", "move-down");
    if (dx === 0 && dy === 0) return;
    const len = Math.hypot(dx, dy) || 1;
    const step = PLAYER_SPEED * dt;
    const p = this.transform.position;
    this.transform.setPosition(
      MathUtils.clamp(p.x + (dx / len) * step, 40, WIDTH - 40),
      MathUtils.clamp(p.y + (dy / len) * step, 110, HEIGHT - 90),
    );
  }
}

/** A floor bundle: walk over it and it pours into the right inventory.
 *  Partial acceptance is the point — only what fits leaves the floor. */
class Pickup extends Component {
  private label?: TextComponent | undefined;
  /** True once a collect attempt was fully rejected this visit — stops the
   *  every-frame retry (and its repeating "bag full" toast) until the player
   *  steps out of range and back in. */
  private lingering = false;

  constructor(
    private readonly cfg: {
      readonly itemId: ItemId;
      quantity: number;
      readonly playerPos: () => Vec2;
      /** Pour into the game's inventories; returns how many were accepted. */
      readonly collect: (itemId: ItemId, quantity: number) => number;
    },
  ) {
    super();
  }

  onAdd(): void {
    const here = this.entity.get(Transform).position;
    const tip = this.scene.spawn("pickup-label");
    tip.add(new Transform({ position: new Vec2(here.x, here.y - 22) }));
    this.label = tip.add(
      new TextComponent({
        text: this.labelText(),
        style: { fontSize: 11, fill: 0xcccccc, fontFamily: "sans-serif" },
        layer: ROOM_LAYER,
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
  }

  onDestroy(): void {
    this.label?.entity.destroy();
    this.label = undefined;
  }

  update(): void {
    const me = this.entity.get(Transform).position;
    const pp = this.cfg.playerPos();
    if (Math.hypot(me.x - pp.x, me.y - pp.y) > 26) {
      this.lingering = false; // left range — a fresh approach may fit now
      return;
    }
    if (this.lingering) return; // already refused this visit; don't re-toast every frame
    const accepted = this.cfg.collect(this.cfg.itemId, this.cfg.quantity);
    if (accepted <= 0) {
      this.lingering = true; // stays on the floor (bag full / capped)
      return;
    }
    this.cfg.quantity -= accepted;
    if (this.cfg.quantity <= 0) this.entity.destroy();
    else if (this.label) this.label.text.text = this.labelText();
  }

  private labelText(): string {
    const name = CATALOG.get(this.cfg.itemId).name;
    return this.cfg.quantity > 1 ? `${name} ×${this.cfg.quantity}` : name;
  }
}

/** The vault door: interacting with it queries + consumes the gold key while
 *  every inventory panel is CLOSED — the model is just data the game reads. */
class VaultDoor extends Component {
  private readonly input = this.service(InputManagerKey);
  private gfx!: GraphicsComponent;
  private prompt!: TextComponent;
  private open = false;

  constructor(
    private readonly cfg: {
      readonly playerPos: () => Vec2;
      readonly isBusy: () => boolean;
      readonly tryUnlock: () => boolean;
      readonly onOpened: () => void;
    },
  ) {
    super();
  }

  onAdd(): void {
    this.gfx = this.entity.add(new GraphicsComponent({ layer: ROOM_LAYER }));
    this.draw();
    const here = this.entity.get(Transform).position;
    const tip = this.scene.spawn("door-prompt");
    tip.add(new Transform({ position: new Vec2(here.x - 52, here.y) }));
    this.prompt = tip.add(
      new TextComponent({
        text: "E unlock",
        style: { fontSize: 12, fill: 0xffffff, fontFamily: "sans-serif" },
        layer: ROOM_LAYER,
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
    this.prompt.text.visible = false;
  }

  update(): void {
    if (this.open) return;
    const me = this.entity.get(Transform).position;
    const pp = this.cfg.playerPos();
    const near = !this.cfg.isBusy() && Math.hypot(me.x - pp.x, me.y - pp.y) <= 70;
    this.prompt.text.visible = near;
    if (near && this.input.isJustPressed("interact") && this.cfg.tryUnlock()) {
      this.open = true;
      this.prompt.text.visible = false;
      this.draw();
      this.cfg.onOpened();
    }
  }

  private draw(): void {
    this.gfx.draw((g) => {
      g.clear();
      g.roundRect(-16, -52, 32, 104, 4).fill({ color: this.open ? 0x1d3320 : 0x4a3826 });
      g.roundRect(-16, -52, 32, 104, 4).stroke({
        color: this.open ? 0x6be08a : 0xffd866,
        width: 2,
      });
      if (!this.open) g.circle(8, 0, 3).fill({ color: 0xffd866 });
    });
  }
}

/** HP bar + live potion counter + equipped line + a transient toast. */
class Hud extends Component {
  private toastText!: TextComponent;
  private potionText!: TextComponent;
  private equippedText!: TextComponent;
  private hpGfx!: GraphicsComponent;
  private toastTtl = 0;

  constructor(private readonly state: DemoState) {
    super();
  }

  onAdd(): void {
    this.entity.add(new Transform());
    this.hpGfx = this.entity.add(new GraphicsComponent({ layer: HUD_LAYER }));
    // One entity per text node (an entity holds one component per class),
    // positioned through its Transform.
    const text = (
      x: number,
      y: number,
      size: number,
      fill: number,
      anchor = { x: 0, y: 0 },
      content = "",
    ): TextComponent => {
      const e = this.scene.spawn("hud-text");
      e.add(new Transform({ position: new Vec2(x, y) }));
      return e.add(
        new TextComponent({
          text: content,
          style: { fontSize: size, fill, fontFamily: "sans-serif" },
          layer: HUD_LAYER,
          anchor,
        }),
      );
    };
    this.potionText = text(WIDTH - 16, 14, 13, 0xf0f0f0, { x: 1, y: 0 });
    this.equippedText = text(WIDTH - 16, 34, 13, 0xc9c9de, { x: 1, y: 0 });
    // Toast at top-center (below the title): the bottom apron belongs to the hotbar.
    this.toastText = text(WIDTH / 2, 80, 14, 0xffd866, { x: 0.5, y: 0.5 });
    // Controls at the very bottom, below the hotbar strip.
    text(
      WIDTH / 2,
      HEIGHT - 14,
      11,
      0x8888aa,
      { x: 0.5, y: 0.5 },
      "WASD move · E interact · I backpack · K key items · R sort (open) · Esc close",
    );
  }

  toast(message: string): void {
    this.state.lastToast = message;
    this.toastText.text.text = message;
    this.toastTtl = 2.6;
  }

  update(dt: number): void {
    if (this.toastTtl > 0) {
      this.toastTtl -= dt;
      if (this.toastTtl <= 0) this.toastText.text.text = "";
    }
    this.potionText.text.text = `Potions: ${this.state.potions}`;
    this.equippedText.text.text = this.state.equipped
      ? `Equipped: ${CATALOG.get(this.state.equipped).name}`
      : "Equipped: —";
    this.hpGfx.draw((g) => {
      g.clear();
      g.roundRect(16, 14, 160, 14, 4).fill({ color: 0x26263e });
      if (this.state.hp > 0) {
        g.roundRect(16, 14, Math.max(8, 160 * (this.state.hp / 100)), 14, 4).fill({
          color: 0xff5566,
        });
      }
      g.roundRect(16, 14, 160, 14, 4).stroke({ color: 0x4a4a8a, width: 1 });
    });
  }
}

/** Quick-use belt: number keys 1–N fire the "use" action on the matching
 *  hotbar cell — a PRESENTED index into `inventory`, the same filtered
 *  view the hotbar panel shows, so key 1 always hits whatever the strip's
 *  first cell displays. Frozen while a panel is open (those keys drive the
 *  open panel then). */
class HotbarQuickUse extends Component {
  private readonly input = this.service(InputManagerKey);

  constructor(
    private readonly cfg: {
      readonly inventory: InventorySource<ItemId>;
      readonly slots: number;
      readonly isBusy: () => boolean;
    },
  ) {
    super();
  }

  update(): void {
    if (this.cfg.isBusy()) return;
    for (let i = 0; i < this.cfg.slots; i++) {
      if (this.input.isJustPressed(`quick-${i + 1}`)) this.cfg.inventory.invokeAction("use", i);
    }
  }
}

/** Whether an item offers the "use" action — the hotbar's filter (only
 *  potions/elixirs are usable; gear, treasure, and key items are excluded
 *  from the strip entirely rather than shown inert). */
function isUsable(_stack: unknown, def: ItemDef<ItemId>): boolean {
  return def.actions?.includes("use") ?? false;
}

// ── item actions: labels + availability injected as policy ───────────────────

function itemActions(state: DemoState): ItemActionDef<ItemId>[] {
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

// ── the scene ─────────────────────────────────────────────────────────────────

class InventoryRoomScene extends Scene {
  readonly name = "inventory-addon";
  readonly layers = LAYERS;

  onEnter(): void {
    this.drawRoom();
    Assets.cache.set(ICON_POTION, makePotionIcon());

    const state: DemoState = { hp: 55, equipped: null, potions: 0, lastToast: "" };

    // ── the two inventories: rules in (capacity, stacking, filters, actions) ──
    const actions = itemActions(state);
    const backpack = new Inventory({ catalog: CATALOG, capacity: 15, actions });
    const keyItems = new Inventory({
      catalog: CATALOG,
      autoCompact: true, // list-style: no holes
      accepts: (def) => def.category === "key",
      actions: actions.filter((a) => a.id === "examine"),
    });

    // Player.
    const player = this.spawn("player");
    player.add(new Transform({ position: new Vec2(160, 300) }));
    const playerGfx = player.add(new GraphicsComponent({ layer: ROOM_LAYER }));
    const drawPlayer = (): void => {
      playerGfx.draw((g) => {
        g.clear();
        g.circle(0, 0, 13).fill({ color: 0x6be08a });
        g.circle(0, 0, 13).stroke({ color: 0xffffff, width: 2, alpha: 0.7 });
        if (state.equipped === "sword") {
          g.moveTo(10, -4).lineTo(22, -16).stroke({ color: 0xc9c9de, width: 3 });
        } else if (state.equipped === "shield") {
          g.roundRect(10, -8, 8, 16, 3).fill({ color: 0xffa07a });
        }
      });
    };
    drawPlayer();
    const playerPos = (): Vec2 => player.get(Transform).position;

    this.spawn(CameraEntity, { position: new Vec2(WIDTH / 2, HEIGHT / 2) });

    // ── the two panels: icon grid for the backpack, text rows for the pouch ───
    const backpackBundle = createInventoryPanel(undefined, { columns: 5, visibleRows: 3 });
    const backpackHost = this.spawn("backpack-ui");
    const backpackCtrl = backpackHost.add(
      new InventoryController({
        ...backpackBundle,
        inventory: backpack,
        title: "Backpack",
        // No `input`: the default is full keyboard/gamepad + mouse/touch,
        // pointer hit-testing already wired to this bundle's presenters.
      }),
    );

    const pouchBundle = createInventoryPanel(undefined, { cell: rowCell, visibleRows: 6 });
    const pouchHost = this.spawn("pouch-ui");
    const pouchCtrl = pouchHost.add(
      new InventoryController({
        ...pouchBundle,
        inventory: keyItems,
        title: "Key Items",
        // Custom binding only to RENAME an action: this panel toggles on K.
        input: inventoryControls(pouchBundle, {
          actions: { ...INVENTORY_ACTIONS, toggle: ["key-items"] },
        }),
      }),
    );

    // Embedded quick-use belt: a FILTERED VIEW of the same backpack model
    // (only items offering "use" — potions/elixirs) in a chrome-less one-row
    // strip pinned by `bounds`, centered along the bottom. Because it's a
    // view over the shared model, using an item here or in the backpack
    // panel is one mutation either way. `input: null` + `closeOnCancel: false`
    // + `openOnAdd` keep the controller a passive live mirror — it never
    // opens/closes or consumes device input on its own; the host drives it.
    // Number keys 1–HOTBAR_SLOTS use the matching cell (HotbarQuickUse
    // below), so the strip is interactive without a binding.
    const usableItems = filteredView(backpack, isUsable);
    const hotbarBundle = createInventoryPanel(
      // A chrome-less strip needs far less inset than the framed panels; the
      // default 16px padding would crush a one-row cell to ~20px tall.
      { ...defaultInventoryTheme(), padding: 8 },
      {
        bounds: HOTBAR_BOUNDS,
        columns: HOTBAR_SLOTS,
        chrome: false,
        detail: false,
        actionMenu: false,
        visibleRows: 1,
      },
    );
    let hotbarCancels = 0;
    const hotbarCtrl = this.spawn("hotbar-ui").add(
      new InventoryController({
        ...hotbarBundle,
        inventory: usableItems,
        input: null,
        closeOnCancel: false,
        openOnAdd: true,
        onCancel: () => {
          hotbarCancels += 1;
        },
      }),
    );
    // Label the strip as an interactive belt so its number-key controls read.
    const caption = this.spawn("hotbar-caption");
    caption.add(new Transform({ position: new Vec2(WIDTH / 2, HOTBAR_BOUNDS.y - 10) }));
    caption.add(
      new TextComponent({
        text: `Quick-use · 1–${HOTBAR_SLOTS}`,
        style: { fontSize: 11, fill: 0x8888aa, fontFamily: "sans-serif" },
        layer: HUD_LAYER,
        anchor: { x: 0.5, y: 0.5 },
      }),
    );

    // One panel at a time — host policy, two lines of it. (The hotbar is
    // always-on and outside this policy.)
    backpackHost.on(InventoryOpenedEvent, () => pouchCtrl.close());
    pouchHost.on(InventoryOpenedEvent, () => backpackCtrl.close());
    const anyPanelOpen = (): boolean => backpackCtrl.isOpen() || pouchCtrl.isOpen();

    // Number keys 1–HOTBAR_SLOTS use the matching hotbar cell (backpack slots 0..N-1).
    this.spawn("hotbar-input").add(
      new HotbarQuickUse({ inventory: usableItems, slots: HOTBAR_SLOTS, isBusy: anyPanelOpen }),
    );

    // HUD + toasts.
    const hud = this.spawn("hud").add(new Hud(state));

    // ── pickups pour into the right inventory; partial acceptance is normal ──
    const collect = (itemId: ItemId, quantity: number): number => {
      const def = CATALOG.get(itemId);
      const target = def.category === "key" ? keyItems : backpack;
      const res = target.add(itemId, quantity);
      if (res.added > 0) {
        hud.toast(`+${res.added} ${def.name}${def.category === "key" ? " (pouch)" : ""}`);
      }
      return res.added;
    };

    // ── consequences out: ONE handler applies what actions mean ──────────────
    // Engine-bus payloads carry `string` ids; `CATALOG.has` is a type
    // predicate, so one guard narrows `e.itemId` for the whole handler.
    backpackHost.on(InventoryActionEvent, (e) => {
      if (!CATALOG.has(e.itemId)) return;
      const id = e.itemId;
      const def = CATALOG.get(id);
      if (e.actionId === "use") {
        const heal = id === "elixir" ? 100 : 25;
        state.hp = Math.min(100, state.hp + heal);
        hud.toast(`Used ${def.name} (+${heal} HP)`);
      } else if (e.actionId === "equip") {
        state.equipped = id;
        drawPlayer();
        hud.toast(`Equipped ${def.name}`);
      } else if (e.actionId === "unequip") {
        state.equipped = null;
        drawPlayer();
        hud.toast(`Unequipped ${def.name}`);
      } else if (e.actionId === "drop") {
        // `drop` consumes 1 from the stack (e.consumes); give it back to the world.
        const p = playerPos();
        this.spawnPickup(id, 1, p.x + 36, p.y + 22, playerPos, collect);
        hud.toast(`Dropped ${def.name}`);
      } else if (e.actionId === "examine") {
        hud.toast(def.description ?? def.name);
      }
    });
    pouchHost.on(InventoryActionEvent, (e) => {
      if (e.actionId === "examine" && CATALOG.has(e.itemId)) {
        const def = CATALOG.get(e.itemId);
        hud.toast(def.description ?? def.name);
      }
    });

    // Rejections + live counters — model events fire with the UI closed too.
    const rejectionToast = (e: { itemId: string; quantity: number; reason: RejectReason }): void => {
      if (!CATALOG.has(e.itemId)) return;
      const def = CATALOG.get(e.itemId);
      hud.toast(
        e.reason === "filtered"
          ? "The pouch only takes key items"
          : e.reason === "stack-cap"
            ? `Can't carry more ${def.name} (${e.quantity} left behind)`
            : `Backpack full (${e.quantity} × ${def.name} left behind)`,
      );
    };
    backpackHost.on(InventoryRejectedEvent, rejectionToast);
    pouchHost.on(InventoryRejectedEvent, rejectionToast);
    const syncPotions = (): void => {
      state.potions = backpack.count("potion");
    };
    backpackHost.on(InventoryItemAddedEvent, syncPotions);
    backpackHost.on(InventoryItemRemovedEvent, syncPotions);

    // ── the floor loot ─────────────────────────────────────────────────────────
    const drops: [ItemId, number, number, number][] = [
      ["potion", 2, 300, 220],
      ["potion", 1, 420, 180],
      ["potion", 3, 520, 300],
      ["elixir", 1, 250, 420],
      ["gem", 12, 360, 380],
      ["gem", 9, 610, 200],
      ["arrows", 20, 450, 460],
      ["arrows", 20, 560, 430], // second bundle: only 10 fit the 30-cap
      ["sword", 1, 200, 180],
      ["shield", 1, 660, 340],
      ["goldKey", 1, 640, 480],
      ["oldMap", 1, 300, 500],
    ];
    for (const [id, qty, x, y] of drops) this.spawnPickup(id, qty, x, y, playerPos, collect);

    // ── the vault door: works entirely against the CLOSED key-items model ─────
    const door = this.spawn("vault-door");
    door.add(new Transform({ position: new Vec2(WIDTH - 26, 300) }));
    door.add(
      new VaultDoor({
        playerPos,
        isBusy: anyPanelOpen,
        tryUnlock: () => {
          if (!keyItems.has("goldKey")) {
            hud.toast("Locked. It wants a gold key.");
            return false;
          }
          keyItems.remove("goldKey", 1);
          return true;
        },
        onOpened: () => {
          hud.toast("The vault opens! Treasure spills out.");
          this.spawnPickup("gem", 30, WIDTH - 96, 250, playerPos, collect);
          this.spawnPickup("elixir", 1, WIDTH - 116, 350, playerPos, collect);
        },
      }),
    );

    player.add(new PlayerMover(anyPanelOpen));

    // E2E / console handle.
    exposeProbe({
      backpack,
      keyItems,
      backpackCtrl,
      pouchCtrl,
      hotbarCtrl,
      hotbarCancels: () => hotbarCancels,
      state,
    });
  }

  private spawnPickup(
    itemId: ItemId,
    quantity: number,
    x: number,
    y: number,
    playerPos: () => Vec2,
    collect: (itemId: ItemId, quantity: number) => number,
  ): void {
    const def = CATALOG.get(itemId);
    const e = this.spawn(`pickup-${itemId}`);
    e.add(new Transform({ position: new Vec2(x, y) }));
    e.add(
      new GraphicsComponent({ layer: ROOM_LAYER }).draw((g) => {
        g.roundRect(-9, -9, 18, 18, 5).fill({ color: def.color ?? 0xc9c9de, alpha: 0.95 });
        g.roundRect(-9, -9, 18, 18, 5).stroke({ color: 0xffffff, width: 1.5, alpha: 0.5 });
      }),
    );
    e.add(new Pickup({ itemId, quantity, playerPos, collect }));
  }

  private drawRoom(): void {
    const bg = this.spawn("room-bg");
    bg.add(new Transform());
    bg.add(
      new GraphicsComponent({ layer: ROOM_LAYER }).draw((g) => {
        g.rect(0, 0, WIDTH, HEIGHT).fill({ color: 0x10101c });
        g.roundRect(24, 90, WIDTH - 48, HEIGHT - 160, 12).fill({ color: 0x181828 });
        g.roundRect(24, 90, WIDTH - 48, HEIGHT - 160, 12).stroke({ color: 0x2c2c4a, width: 2 });
        for (let x = 70; x < WIDTH - 60; x += 90) {
          for (let y = 140; y < HEIGHT - 110; y += 80) {
            g.circle(x, y, 1.6).fill({ color: 0x232338 });
          }
        }
      }),
    );
    const title = this.spawn("room-title");
    title.add(new Transform({ position: new Vec2(WIDTH / 2, 56) }));
    title.add(
      new TextComponent({
        text: "Scavenge the room — the vault wants a gold key",
        style: { fontSize: 15, fill: 0x8888aa, fontFamily: "sans-serif" },
        layer: ROOM_LAYER,
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
  }
}

// ── canvas-drawn potion icon (the zero-asset icon path) ──────────────────────

function makePotionIcon(): Texture {
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

// ── inspector/e2e probe ───────────────────────────────────────────────────────

interface InventoryProbeHandle {
  readonly backpack: Inventory<ItemId>;
  readonly keyItems: Inventory<ItemId>;
  readonly backpackCtrl: InventoryController<ItemId>;
  readonly pouchCtrl: InventoryController<ItemId>;
  readonly hotbarCtrl: InventoryController<ItemId>;
  readonly hotbarCancels: () => number;
  readonly state: DemoState;
}

function exposeProbe(handle: InventoryProbeHandle): void {
  (window as unknown as { __inventory__: InventoryProbeHandle }).__inventory__ = handle;
}

// ── boot ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const engine = new Engine({ debug: true });
  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x0a0a0a,
      container: setupGameContainer(WIDTH, HEIGHT),
    }),
  );
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
      preventDefaultKeys: ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
    }),
  );
  await installDebugFromUrl(engine);
  await engine.start();
  await engine.scenes.push(new InventoryRoomScene());
}

main().catch(console.error);

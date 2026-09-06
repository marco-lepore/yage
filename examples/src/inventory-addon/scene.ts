import { registerTexture } from "@yagejs/renderer";
import { TopDownPlayerMover } from "../shared/TopDownPlayerMover.js";
import { Scene, Transform, Vec2 } from "@yagejs/core";
import { CameraEntity, GraphicsComponent, TextComponent } from "@yagejs/renderer";
import {
  INVENTORY_ACTIONS,
  filteredView,
  inventoryControls,
  Inventory,
  InventoryActionEvent,
  InventoryController,
  InventoryItemAddedEvent,
  InventoryItemRemovedEvent,
  InventoryOpenedEvent,
  InventoryRejectedEvent,
  type RejectReason,
} from "@yagejs-addons/inventory";
import {
  createInventoryPanel,
  defaultInventoryTheme,
  rowCell,
} from "@yagejs-addons/inventory/presenters";
import {
  HEIGHT,
  PLAYER_SPEED,
  HOTBAR_BOUNDS,
  HOTBAR_SLOTS,
  HUD_LAYER,
  ICON_POTION,
  LAYERS,
  ROOM_LAYER,
  WIDTH,
} from "./constants.js";
import { CATALOG, type DemoState, type ItemId, isUsable, itemActions, makePotionIcon } from "./catalog.js";
import { HotbarQuickUse, Hud, Pickup, VaultDoor } from "./components.js";
import { exposeProbe } from "./probe.js";

// ── the scene ─────────────────────────────────────────────────────────────────

export class InventoryRoomScene extends Scene {
  readonly name = "inventory-addon";
  readonly layers = LAYERS;

  onEnter(): void {
    this.drawRoom();
    registerTexture(ICON_POTION, makePotionIcon());

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

    player.add(
      new TopDownPlayerMover({
        speed: PLAYER_SPEED,
        bounds: { minX: 40, maxX: WIDTH - 40, minY: 110, maxY: HEIGHT - 90 },
        isBlocked: anyPanelOpen,
      }),
    );

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

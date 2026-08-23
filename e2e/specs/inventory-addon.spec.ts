import { expect, test, type Page } from "@playwright/test";
import { gotoFixture, stepFrames, waitForClock } from "./helpers.js";

/**
 * The fixture (`examples/src/inventory-addon.ts`) exposes its two models,
 * both controllers, and the demo state on `window.__inventory__`. Tests
 * drive the controller's input-agnostic host API (the same calls the default
 * `InputBinding` makes) and mutate/read the MODEL — the headless source of
 * truth the views observe.
 */
interface Handle {
  backpack: {
    add(id: string, quantity?: number): { added: number };
    setSlot(slot: number, stack: { itemId: string; quantity: number } | null): void;
    count(id: string): number;
    used: number;
    isFull: boolean;
    snapshot(): { slots: ({ itemId: string; quantity: number } | null)[] };
  };
  keyItems: { add(id: string, quantity?: number): { added: number }; count(id: string): number };
  backpackCtrl: {
    open(): void;
    close(): void;
    toggle(): void;
    isOpen(): boolean;
    isMenuOpen(): boolean;
    selection(): number;
    move(dir: "up" | "down" | "left" | "right"): void;
    confirm(): void;
    cancel(): void;
    sort(): void;
  };
  pouchCtrl: { open(): void; isOpen(): boolean };
  hotbarCtrl: { isOpen(): boolean; cancel(): void };
  hotbarCancels: () => number;
  state: { hp: number; potions: number; lastToast: string };
}

/** The embedded hotbar's pinned rect (fixture: bottom-center, chrome-less). */
const HOTBAR_BOUNDS = { x: (800 - 300) / 2, y: 600 - 90, width: 300, height: 66 };

interface ProbeData {
  potions: number;
  arrows: number;
  used: number;
  isFull: boolean;
  slots: ({ itemId: string; quantity: number } | null)[];
  keyCount: number;
  isOpen: boolean;
  pouchOpen: boolean;
  isMenuOpen: boolean;
  selection: number;
  hp: number;
  hudPotions: number;
  lastToast: string;
}

/** One JSON-able snapshot of everything the tests assert on. */
function probe(page: Page): Promise<ProbeData> {
  return page.evaluate(() => {
    const h = (window as unknown as { __inventory__: Handle }).__inventory__;
    return {
      potions: h.backpack.count("potion"),
      arrows: h.backpack.count("arrows"),
      used: h.backpack.used,
      isFull: h.backpack.isFull,
      slots: h.backpack.snapshot().slots,
      keyCount: h.keyItems.count("goldKey"),
      isOpen: h.backpackCtrl.isOpen(),
      pouchOpen: h.pouchCtrl.isOpen(),
      isMenuOpen: h.backpackCtrl.isMenuOpen(),
      selection: h.backpackCtrl.selection(),
      hp: h.state.hp,
      hudPotions: h.state.potions,
      lastToast: h.state.lastToast,
    };
  });
}

async function add(page: Page, itemId: string, quantity: number, target: "backpack" | "keyItems" = "backpack"): Promise<void> {
  await page.evaluate(
    ({ itemId: id, quantity: q, target: t }) => {
      const h = (window as unknown as { __inventory__: Handle }).__inventory__;
      h[t].add(id, q);
    },
    { itemId, quantity, target },
  );
}

async function ctrl(
  page: Page,
  method: "open" | "close" | "toggle" | "confirm" | "cancel" | "sort",
): Promise<void> {
  await page.evaluate((m) => {
    const h = (window as unknown as { __inventory__: Handle }).__inventory__;
    h.backpackCtrl[m]();
  }, method);
}

async function move(page: Page, dir: "up" | "down" | "left" | "right"): Promise<void> {
  await page.evaluate((d) => {
    const h = (window as unknown as { __inventory__: Handle }).__inventory__;
    h.backpackCtrl.move(d);
  }, dir);
}

async function boot(page: Page): Promise<void> {
  await gotoFixture(page, "/inventory-addon.html");
  await waitForClock(page);
  await page.waitForFunction(
    () => (window as unknown as { __inventory__?: unknown }).__inventory__ !== undefined,
  );
  await stepFrames(page, 2);
}

test.describe("@yagejs-addons/inventory addon", () => {
  test("the model is live while the panel is closed (adds, events, HUD sync)", async ({
    page,
  }) => {
    await boot(page);

    const before = await probe(page);
    expect(before.isOpen).toBe(false);
    expect(before.potions).toBe(0);

    // Game code pours into the CLOSED inventory; the HUD counter follows via
    // InventoryItemAddedEvent — no panel involved.
    await add(page, "potion", 3);
    const after = await probe(page);
    expect(after.isOpen).toBe(false);
    expect(after.potions).toBe(3);
    expect(after.hudPotions).toBe(3);
  });

  test("toggle opens the panel; cursor navigation follows the 5-column grid", async ({
    page,
  }) => {
    await boot(page);

    await ctrl(page, "toggle");
    await stepFrames(page, 1);
    expect((await probe(page)).isOpen).toBe(true);

    // Down = +columns (5), right = +1 — the slots view owns the geometry.
    await move(page, "down");
    expect((await probe(page)).selection).toBe(5);
    await move(page, "right");
    expect((await probe(page)).selection).toBe(6);
    await move(page, "up");
    expect((await probe(page)).selection).toBe(1);

    await ctrl(page, "close");
    expect((await probe(page)).isOpen).toBe(false);
  });

  test("opening one panel closes the other (host exclusivity policy)", async ({ page }) => {
    await boot(page);

    await ctrl(page, "open");
    await page.evaluate(() => {
      (window as unknown as { __inventory__: Handle }).__inventory__.pouchCtrl.open();
    });
    const p = await probe(page);
    expect(p.pouchOpen).toBe(true);
    expect(p.isOpen).toBe(false);
  });

  test("the action menu invokes Use through the model: heals and consumes", async ({
    page,
  }) => {
    await boot(page);

    await add(page, "potion", 3);
    await ctrl(page, "open");
    await stepFrames(page, 1);

    // Slot 0 holds the potions; confirm opens its menu, confirm again invokes
    // the highlighted first action ("Use": consumes 1 and heals 25).
    await ctrl(page, "confirm");
    expect((await probe(page)).isMenuOpen).toBe(true);
    await ctrl(page, "confirm");
    await stepFrames(page, 1);

    const after = await probe(page);
    expect(after.isMenuOpen).toBe(false);
    expect(after.potions).toBe(2);
    expect(after.hp).toBe(80); // 55 + 25
    expect(after.hudPotions).toBe(2);
    expect(after.lastToast).toContain("Used Potion");
  });

  test("cancel closes the menu first, then the panel", async ({ page }) => {
    await boot(page);
    await add(page, "potion", 1);
    await ctrl(page, "open");
    await ctrl(page, "confirm");
    expect((await probe(page)).isMenuOpen).toBe(true);

    await ctrl(page, "cancel");
    let p = await probe(page);
    expect(p.isMenuOpen).toBe(false);
    expect(p.isOpen).toBe(true);

    await ctrl(page, "cancel");
    p = await probe(page);
    expect(p.isOpen).toBe(false);
  });

  test("single-stacking arrows cap at 30 total and reject the excess", async ({ page }) => {
    await boot(page);

    await add(page, "arrows", 20);
    await add(page, "arrows", 20);
    const p = await probe(page);
    expect(p.arrows).toBe(30); // capped, never a second stack
    expect(p.slots.filter((s) => s?.itemId === "arrows")).toHaveLength(1);
    expect(p.lastToast).toContain("Can't carry more Arrows");
  });

  test("a full backpack accepts partially and reports the rejection", async ({ page }) => {
    await boot(page);

    // 15 unstackable swords fill all 15 slots.
    await add(page, "sword", 15);
    let p = await probe(page);
    expect(p.isFull).toBe(true);

    await add(page, "potion", 2);
    p = await probe(page);
    expect(p.potions).toBe(0);
    expect(p.lastToast).toContain("Backpack full");
  });

  test("the key-items pouch filters by category", async ({ page }) => {
    await boot(page);

    await add(page, "potion", 1, "keyItems"); // filtered out
    let p = await probe(page);
    expect(p.lastToast).toContain("only takes key items");

    await add(page, "goldKey", 1, "keyItems");
    p = await probe(page);
    expect(p.keyCount).toBe(1);
  });

  test("sort consolidates partial stacks and orders by catalog order", async ({ page }) => {
    await boot(page);

    // Scatter: two partial potion stacks around a sword and a gem pile.
    await page.evaluate(() => {
      const h = (window as unknown as { __inventory__: Handle }).__inventory__;
      h.backpack.setSlot(4, { itemId: "potion", quantity: 2 });
      h.backpack.setSlot(1, { itemId: "sword", quantity: 1 });
      h.backpack.setSlot(9, { itemId: "potion", quantity: 2 });
      h.backpack.setSlot(6, { itemId: "gem", quantity: 5 });
    });
    await ctrl(page, "open");
    await ctrl(page, "sort");
    await stepFrames(page, 1);

    const p = await probe(page);
    // Catalog order: potion, gem, sword — potions consolidated 2+2 → one 4-stack.
    expect(p.slots.slice(0, 4)).toEqual([
      { itemId: "potion", quantity: 4 },
      { itemId: "gem", quantity: 5 },
      { itemId: "sword", quantity: 1 },
      null,
    ]);
  });

  test("embedded hotbar opens at boot and survives cancel (closeOnCancel:false + onCancel)", async ({
    page,
  }) => {
    await boot(page);

    const openAtBoot = await page.evaluate(
      () => (window as unknown as { __inventory__: Handle }).__inventory__.hotbarCtrl.isOpen(),
    );
    expect(openAtBoot).toBe(true); // openOnAdd, no toggle needed

    await page.evaluate(() =>
      (window as unknown as { __inventory__: Handle }).__inventory__.hotbarCtrl.cancel(),
    );
    const after = await page.evaluate(() => {
      const h = (window as unknown as { __inventory__: Handle }).__inventory__;
      return { open: h.hotbarCtrl.isOpen(), cancels: h.hotbarCancels() };
    });
    expect(after.open).toBe(true); // closeOnCancel:false — the host owns the escape route
    expect(after.cancels).toBe(1); // onCancel still fired
  });

  /** Content entities (icon/letter/quantity badge) carry a Transform
   *  position; the cell background doesn't (it draws at absolute rect
   *  coordinates, not through its own Transform), so counting `inv-` entities
   *  inside the strip's rect counts rendered CONTENT, not background tiles. */
  function contentEntitiesInStrip(page: Page): Promise<number> {
    return page.evaluate((b) => {
      const ents = (
        window as unknown as {
          __yage__: { inspector: { getEntities(): { name: string; position?: { x: number; y: number } }[] } };
        }
      ).__yage__.inspector.getEntities();
      return ents.filter(
        (e) =>
          e.name.startsWith("inv-") &&
          e.position !== undefined &&
          e.position.x >= b.x &&
          e.position.x <= b.x + b.width &&
          e.position.y >= b.y &&
          e.position.y <= b.y + b.height,
      ).length;
    }, HOTBAR_BOUNDS);
  }

  test("embedded hotbar derives cells from its bounds and renders them in the strip", async ({
    page,
  }) => {
    await boot(page);
    // Of these three, only potion offers "use" — the hotbar's filteredView
    // shows just the one matching cell (gem/sword are excluded, not inert).
    await add(page, "potion", 3);
    await add(page, "gem", 4);
    await add(page, "sword", 1);
    await stepFrames(page, 2);

    // The one usable stack's cell: a tile-letter fallback (no icon texture in
    // this fixture's catalog) plus a quantity badge (3 > 1).
    expect(await contentEntitiesInStrip(page)).toBe(2);
  });

  test("embedded hotbar's filteredView excludes non-usable stacks entirely", async ({ page }) => {
    await boot(page);

    // Gear and treasure don't offer "use" — the strip renders no cell at all
    // (a full-mirror hotbar would instead show two inert cells here).
    await add(page, "sword", 1);
    await add(page, "gem", 3);
    await stepFrames(page, 2);
    expect(await contentEntitiesInStrip(page)).toBe(0);

    // A usable item lands the strip's one (and only) cell.
    await add(page, "potion", 1);
    await stepFrames(page, 2);
    expect(await contentEntitiesInStrip(page)).toBe(1);
  });
});

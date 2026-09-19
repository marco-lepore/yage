import { expect, test, type Page } from "@playwright/test";
import {
  getComponentData,
  gotoFixture,
  stepFrames,
  waitForClock,
} from "./helpers.js";

interface ProbeData {
  focusedLabel: string;
  menuFocusedLabel: string;
  activeScope: string;
  volume: number;
  music: boolean;
  listOffset: number;
  clicks: number;
  uploadClicks: number;
  deleteClicks: number;
  menuVisible: boolean;
  dialogVisible: boolean;
}

/**
 * 100 ms a frame, against the 0.35 s delay and 0.1 s interval a focus scope
 * repeats on: no threshold lands on a frame boundary, so the frame a repeat
 * arrives on is the same every run.
 */
const FRAME_MS = 100;

/** Index of each menu row among the surface root's children. */
const QUIT_ROW = 3;
const UPLOAD_ROW = 2;
const DIALOG = 7;

async function probe(page: Page): Promise<ProbeData> {
  const data = await getComponentData<ProbeData>(
    page,
    "ui-state",
    "FocusProbe",
  );
  if (!data) throw new Error("FocusProbe data unavailable");
  return data;
}

/**
 * Presses and releases `code` `count` times, one press frame and one release
 * frame each, and reports the focused row after every tap.
 */
async function tap(
  page: Page,
  code: string,
  count = 1,
  device: "key" | "pad" = "key",
): Promise<string[]> {
  return page.evaluate(
    async ({ code: c, count: n, device: d, dt }) => {
      const inspector = window.__yage__!.inspector;
      const press = (down: boolean): void => {
        if (d === "pad") inspector.input.gamepadButton(c, down);
        else if (down) inspector.input.keyDown(c);
        else inspector.input.keyUp(c);
      };
      const read = (): string =>
        (
          inspector.getComponentData(
            "ui-state",
            "FocusProbe",
          ) as unknown as ProbeData
        ).focusedLabel;

      inspector.time.setDelta(dt);
      const seen: string[] = [];
      for (let i = 0; i < n; i++) {
        press(true);
        await inspector.time.stepAsync(1);
        press(false);
        await inspector.time.stepAsync(1);
        seen.push(read());
      }
      return seen;
    },
    { code, count, device, dt: FRAME_MS },
  );
}

/** Loads the fixture and opens the menu with the action it confirms on. */
async function openMenu(page: Page): Promise<void> {
  await gotoFixture(page, "/ui-focus.html");
  await waitForClock(page);
  await stepFrames(page, 2, FRAME_MS);
  await tap(page, "Enter");
}

/** The interaction state each menu row reports to the Inspector. */
async function rowStates(page: Page): Promise<unknown[]> {
  return page.evaluate(() => {
    const ui = window.__yage__!.inspector.snapshot().scenes[0]?.ui;
    if (!ui) throw new Error("the scene reports no UI tree");
    return ui.root.children.map((child) => child.state);
  });
}

/** Moves the pointer onto a node id or a point, reporting what it crossed. */
async function pointerTo(
  page: Page,
  target: string | { x: number; y: number },
): Promise<string[]> {
  return page.evaluate((aim) => {
    const hit = window.__yage__!.inspector.pointer.move(aim);
    return hit.path.map((node) => node.type);
  }, target);
}

/** Presses and releases on a node id or a point, reporting what it crossed. */
async function pointerPress(
  page: Page,
  target: string | { x: number; y: number },
): Promise<string[]> {
  return page.evaluate((aim) => {
    const hit = window.__yage__!.inspector.pointer.click(aim);
    return hit.path.map((node) => node.type);
  }, target);
}

async function rootNodeId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const ui = window.__yage__!.inspector.snapshot().scenes[0]?.ui;
    if (!ui) throw new Error("the scene reports no UI tree");
    return ui.root.id;
  });
}

test.describe("UI focus fixture", () => {
  test("the press that opens the menu focuses the first row and confirms nothing", async ({
    page,
  }) => {
    await openMenu(page);

    const opened = await probe(page);
    expect(opened.menuVisible).toBe(true);
    expect(opened.activeScope).toBe("menu");
    expect(opened.focusedLabel).toBe("Resume");
    expect(opened.clicks).toBe(0);
  });

  test("arrow keys walk the rows and pass over the disabled one", async ({
    page,
  }) => {
    await openMenu(page);

    expect(await tap(page, "ArrowDown", 3)).toEqual([
      "Delete save",
      "Quit",
      "Volume",
    ]);
    expect(await tap(page, "ArrowUp", 2)).toEqual(["Quit", "Delete save"]);

    await tap(page, "ArrowDown");
    const states = await rowStates(page);
    expect(states[QUIT_ROW]).toMatchObject({ focused: true, disabled: false });
    expect(states[UPLOAD_ROW]).toMatchObject({
      focused: false,
      disabled: true,
    });
    expect((await probe(page)).uploadClicks).toBe(0);
  });

  test("a held arrow repeats after the delay and not before", async ({
    page,
  }) => {
    await openMenu(page);

    const seen = await page.evaluate(async (dt) => {
      const inspector = window.__yage__!.inspector;
      const read = (): string =>
        (
          inspector.getComponentData(
            "ui-state",
            "FocusProbe",
          ) as unknown as ProbeData
        ).focusedLabel;

      inspector.time.setDelta(dt);
      const labels: string[] = [];
      inspector.input.keyDown("ArrowDown");
      for (let frame = 0; frame < 4; frame++) {
        await inspector.time.stepAsync(1);
        labels.push(read());
      }
      inspector.input.keyUp("ArrowDown");
      await inspector.time.stepAsync(1);
      return labels;
    }, FRAME_MS);

    // The press moves one row; the hold moves the next one only once it has
    // passed the repeat delay, three frames later.
    expect(seen).toEqual(["Delete save", "Delete save", "Delete save", "Quit"]);
  });

  test("a gamepad stick direction walks the same rows", async ({ page }) => {
    await openMenu(page);

    expect(await tap(page, "GamepadLeftStickDown", 2, "pad")).toEqual([
      "Delete save",
      "Quit",
    ]);
    expect(await tap(page, "GamepadLeftStickUp", 1, "pad")).toEqual([
      "Delete save",
    ]);
  });

  test("confirm runs the focused row's click", async ({ page }) => {
    await openMenu(page);

    await tap(page, "Enter");
    expect((await probe(page)).clicks).toBe(1);

    await tap(page, "ArrowDown", 2);
    await tap(page, "Enter");
    const confirmed = await probe(page);
    expect(confirmed.focusedLabel).toBe("Quit");
    expect(confirmed.clicks).toBe(2);
    expect(confirmed.uploadClicks).toBe(0);
  });

  test("a press moves focus, and moving the pointer away leaves it there", async ({
    page,
  }) => {
    await openMenu(page);
    const root = await rootNodeId(page);
    expect((await probe(page)).focusedLabel).toBe("Resume");

    // The pointer passing over a row leaves focus where the keys put it.
    expect(await pointerTo(page, `${root}/${QUIT_ROW}`)).toContain("UIButton");
    await stepFrames(page, 1, FRAME_MS);
    expect((await probe(page)).focusedLabel).toBe("Resume");

    expect(await pointerPress(page, `${root}/${QUIT_ROW}`)).toContain(
      "UIButton",
    );
    await stepFrames(page, 1, FRAME_MS);
    expect((await probe(page)).focusedLabel).toBe("Quit");

    await pointerTo(page, { x: 4, y: 4 });
    await stepFrames(page, 1, FRAME_MS);
    expect((await probe(page)).focusedLabel).toBe("Quit");
  });

  test("left and right step the stepper row and keep focus on it", async ({
    page,
  }) => {
    await openMenu(page);
    await tap(page, "ArrowDown", 3);
    expect((await probe(page)).focusedLabel).toBe("Volume");

    await tap(page, "ArrowRight");
    const stepped = await probe(page);
    expect(stepped.volume).toBe(65);
    expect(stepped.focusedLabel).toBe("Volume");

    await tap(page, "ArrowLeft");
    expect((await probe(page)).volume).toBe(60);
  });

  test("focus reaching the eighth row scrolls the list to it", async ({
    page,
  }) => {
    await openMenu(page);

    // Rows one and two sit inside the viewport, so reaching them moves the
    // list not at all.
    expect((await tap(page, "ArrowDown", 6)).at(-1)).toBe("Row 2");
    expect((await probe(page)).listOffset).toBe(0);

    expect((await tap(page, "ArrowDown", 6)).at(-1)).toBe("Row 8");
    expect((await probe(page)).listOffset).toBeGreaterThan(0);
  });

  test("showing the dialog takes the keys and hiding it gives them back", async ({
    page,
  }) => {
    await openMenu(page);
    await tap(page, "ArrowDown");
    expect((await probe(page)).focusedLabel).toBe("Delete save");

    // The row's action runs on the confirm release, which is what shows the
    // dialog; the dialog's scope takes the keys on the frame after that, with
    // the confirm already released. So the press that opened the dialog cannot
    // also press the dialog's first row.
    await page.evaluate(async (dt) => {
      const inspector = window.__yage__!.inspector;
      inspector.time.setDelta(dt);
      inspector.input.keyDown("Enter");
      await inspector.time.stepAsync(2);
      inspector.input.keyUp("Enter");
      await inspector.time.stepAsync(1);
    }, FRAME_MS);
    await stepFrames(page, 1, FRAME_MS);

    const shown = await probe(page);
    expect(shown.dialogVisible).toBe(true);
    expect(shown.activeScope).toBe("dialog");
    expect(shown.focusedLabel).toBe("Delete");
    expect(shown.menuFocusedLabel).toBe("Delete save");
    expect(shown.deleteClicks).toBe(0);
    expect((await rowStates(page))[DIALOG]).toMatchObject({
      focusScope: { hasInput: true },
    });

    // Two rows and wrapping on: each end returns to the other.
    expect(await tap(page, "ArrowUp")).toEqual(["Keep"]);
    expect(await tap(page, "ArrowDown")).toEqual(["Delete"]);

    await tap(page, "Escape");
    await stepFrames(page, 1, FRAME_MS);

    const closed = await probe(page);
    expect(closed.dialogVisible).toBe(false);
    expect(closed.activeScope).toBe("menu");
    expect(closed.focusedLabel).toBe("Delete save");
    expect(closed.deleteClicks).toBe(0);
  });
});

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type {
  PlacementResult,
  PlacementSnapshot,
} from "@yagejs-addons/placement";

interface RoomState {
  credits: number;
  locked: boolean;
  saving: boolean;
  saved: boolean;
  message: string;
  layoutState: PlacementSnapshot;
  poses: Record<string, { x: number; y: number; rotation: number }>;
  preview: PlacementResult | null;
  previewTypes: string[];
  view: "topdown" | "side" | "isometric";
}

async function state(page: Page): Promise<RoomState> {
  return page.evaluate(
    () =>
      window.__yage__!.inspector.getComponentData(
        "RoomEditorEntity",
        "RoomEditor",
      ) as RoomState,
  );
}

async function drive(
  page: Page,
  actions: readonly (
    | { key: string }
    | { move: [number, number] }
    | { click: [number, number] }
  )[],
): Promise<void> {
  const result = await page.evaluate(async (actions) => {
    return window.__yage__!.inspector.drive(
      async ({ step, input }) => {
        for (const action of actions) {
          if ("key" in action) await input.tap(action.key);
          if ("move" in action) {
            input.pointerMove(...action.move);
            await step(2);
          }
          if ("click" in action) {
            input.mouseMove(...action.click);
            input.mouseDown(0);
            await step(1);
            input.mouseUp(0);
            await step(2);
          }
        }
        await step(2);
      },
      { render: "last" },
    );
  }, actions);
  expect(result.ok).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/placement.html?test");
  await page.waitForFunction(
    () =>
      window.__yage__?.inspector.time.isFrozen() &&
      window.__yage__.inspector.getSceneStack().at(-1)?.name ===
        "room-workshop",
  );
  await drive(page, []);
});

test("placement moves attached objects, cancels and rejects edits, and revalidates permissions", async ({
  page,
}) => {
  const initial = await state(page);
  expect(initial.layoutState.objects).toHaveLength(4);
  expect(initial.poses.p2).toMatchObject({ x: 352, y: 192 });
  await drive(page, [{ click: [316, 192] }, { move: [384, 384] }]);
  expect((await state(page)).layoutState).toEqual(initial.layoutState);
  expect((await state(page)).preview?.ok).toBe(true);
  await drive(page, [{ key: "Escape" }]);
  expect((await state(page)).layoutState).toEqual(initial.layoutState);
  await drive(page, [
    { click: [316, 192] },
    { move: [384, 384] },
    { key: "Enter" },
  ]);
  const moved = await state(page);
  expect(moved.poses.p1).toMatchObject({ x: 384, y: 384 });
  expect(moved.poses.p2).toMatchObject({ x: 384, y: 384 });
  expect(moved.credits).toBe(initial.credits);
  await drive(page, [
    { click: [350, 384] },
    { move: [824, 432] },
    { key: "Enter" },
  ]);
  expect(
    (await state(page)).preview?.issues.some((i) => i.code === "outside-area"),
  ).toBe(true);
  expect((await state(page)).layoutState).toEqual(moved.layoutState);
  await drive(page, [{ move: [432, 352] }, { key: "KeyP" }, { key: "Enter" }]);
  expect((await state(page)).preview?.issues[0]?.code).toBe("room-locked");
  expect((await state(page)).layoutState).toEqual(moved.layoutState);
  await drive(page, [{ key: "Escape" }, { key: "KeyP" }, { key: "KeyZ" }]);
  expect((await state(page)).poses.p2).toMatchObject({ x: 352, y: 192 });
  await drive(page, [{ key: "KeyY" }]);
  expect((await state(page)).poses.p2).toMatchObject({ x: 384, y: 384 });
  expect(
    await page.evaluate(() => window.__yage__!.inspector.getErrors()),
  ).toMatchObject({ callbackErrors: [] });
});

test("placement duplicates and removes groups, and restores a browser save with finishes and credits", async ({
  page,
}) => {
  await drive(page, [
    { click: [316, 192] },
    { key: "Escape" },
    { key: "KeyD" },
    { move: [480, 352] },
    { key: "Enter" },
  ]);
  const duplicated = await state(page);
  expect(duplicated.layoutState.objects).toHaveLength(6);
  expect(
    duplicated.layoutState.objects.find((o) => o.id === "p6")?.attachment
      ?.parent,
  ).toBe("p5");
  expect(duplicated.credits).toBe(25);
  await drive(page, [{ key: "Delete" }]);
  expect((await state(page)).message).toContain("Remove attached objects");
  expect((await state(page)).layoutState.objects).toHaveLength(6);
  await drive(page, [{ key: "KeyX" }]);
  expect((await state(page)).layoutState.objects).toHaveLength(4);
  await drive(page, [
    { key: "KeyZ" },
    { key: "KeyF" },
    { key: "KeyW" },
    { key: "KeyS" },
  ]);
  await page.waitForFunction(
    () =>
      (
        window.__yage__!.inspector.getComponentData(
          "RoomEditorEntity",
          "RoomEditor",
        ) as RoomState
      ).saved,
  );
  const saved = await state(page);
  expect(saved.layoutState.finishes.studio).toEqual({
    floor: "tile",
    walls: "sand",
  });
  await drive(page, [{ key: "KeyF" }, { key: "KeyL" }]);
  await page.waitForFunction(
    () =>
      (
        window.__yage__!.inspector.getComponentData(
          "RoomEditorEntity",
          "RoomEditor",
        ) as RoomState
      ).message === "Layout loaded from this browser.",
  );
  await drive(page, []);
  expect((await state(page)).layoutState).toEqual(saved.layoutState);
  expect((await state(page)).credits).toBe(saved.credits);
  expect(
    await page.evaluate(() => window.__yage__!.inspector.getErrors()),
  ).toMatchObject({ callbackErrors: [] });
});

test("top-down placement shows recognizable previews and places furniture directly on the floor", async ({
  page,
}) => {
  const before = await state(page);
  await drive(page, [{ click: [80, 174] }, { move: [640, 272] }]);
  const draft = await state(page);
  expect(draft.view).toBe("topdown");
  expect(draft.preview?.ok).toBe(true);
  expect(draft.previewTypes).toEqual(["chair"]);
  expect(draft.layoutState).toEqual(before.layoutState);
  await drive(page, [{ move: [640, 272] }, { key: "Enter" }]);
  expect((await state(page)).layoutState.objects.at(-1)).toMatchObject({
    type: "chair",
    pose: { x: 640, y: 272 },
  });
  expect((await state(page)).previewTypes).toEqual([]);
  await drive(page, [{ click: [80, 222] }, { move: [720, 320] }]);
  expect((await state(page)).preview?.ok).toBe(false);
  expect((await state(page)).previewTypes).toEqual(["lamp"]);
  await drive(page, [{ move: [376, 192] }, { key: "Enter" }]);
  expect((await state(page)).layoutState.objects.at(-1)?.attachment).toEqual({
    parent: "p1",
    socket: "top",
  });
  await drive(page, [{ click: [316, 192] }, { move: [400, 368] }]);
  expect((await state(page)).previewTypes.sort()).toEqual([
    "lamp",
    "lamp",
    "table",
  ]);
  await drive(page, [{ key: "Escape" }]);
  expect((await state(page)).previewTypes).toEqual([]);
});

async function openSideView(page: Page): Promise<void> {
  await page.goto("/placement-side.html?test");
  await page.waitForFunction(
    () =>
      window.__yage__?.inspector.time.isFrozen() &&
      window.__yage__.inspector.getSceneStack().at(-1)?.name ===
        "side-workshop",
  );
  await drive(page, []);
}

test("side-view placement supports furniture on new floor sections and lamps on tables", async ({
  page,
}) => {
  await openSideView(page);
  expect((await state(page)).view).toBe("side");
  expect((await state(page)).layoutState.objects).toHaveLength(7);
  await drive(page, [{ click: [80, 318] }, { move: [736, 300] }]);
  expect((await state(page)).preview?.ok).toBe(true);
  expect((await state(page)).previewTypes).toEqual(["floor"]);
  await drive(page, [{ move: [736, 300] }, { key: "Enter" }]);
  expect((await state(page)).layoutState.objects.at(-1)?.attachment).toEqual({
    parent: "p1",
    socket: "east",
  });
  await drive(page, [{ click: [80, 126] }, { move: [736, 430] }]);
  expect((await state(page)).preview?.ok).toBe(true);
  expect((await state(page)).previewTypes).toEqual(["table"]);
  await drive(page, [{ move: [736, 430] }, { key: "Enter" }]);
  const table = (await state(page)).layoutState.objects.at(-1)!;
  expect(table.attachment).toEqual({ parent: "p8", socket: "top" });
  expect((await state(page)).poses[table.id]).toMatchObject({ x: 736, y: 416 });
  await drive(page, [
    { click: [80, 222] },
    { move: [736, 315] },
    { key: "Enter" },
  ]);
  expect((await state(page)).layoutState.objects.at(-1)?.attachment).toEqual({
    parent: table.id,
    socket: "top",
  });
  expect((await state(page)).poses.p10).toMatchObject({ x: 736, y: 344 });
  expect(
    await page.evaluate(() => window.__yage__!.inspector.getErrors()),
  ).toMatchObject({ callbackErrors: [] });
});

test("side-view placement moves an entire furnished floor section and supports wall pictures", async ({
  page,
}) => {
  await openSideView(page);
  await drive(page, [{ click: [640, 424] }, { move: [736, 400] }]);
  const draft = await state(page);
  expect(draft.preview?.ok).toBe(true);
  expect(draft.previewTypes.sort()).toEqual([
    "art",
    "floor",
    "lamp",
    "table",
    "wall",
  ]);
  await drive(page, [{ move: [736, 400] }, { key: "Enter" }]);
  expect((await state(page)).poses.p4).toMatchObject({ x: 736, y: 344 });
  await drive(page, [
    { key: "KeyZ" },
    { click: [80, 414] },
    { move: [612, 280] },
  ]);
  expect((await state(page)).preview?.ok).toBe(true);
  expect((await state(page)).previewTypes).toEqual(["art"]);
  await drive(page, [{ move: [612, 280] }, { key: "Enter" }]);
  expect((await state(page)).layoutState.objects.at(-1)?.attachment).toEqual({
    parent: "p2",
    socket: "art",
  });
  expect(
    await page.evaluate(() => window.__yage__!.inspector.getErrors()),
  ).toMatchObject({ callbackErrors: [] });
});

async function openIsometricView(page: Page): Promise<void> {
  await page.goto("/placement-iso.html?test");
  await page.waitForFunction(
    () =>
      window.__yage__?.inspector.time.isFrozen() &&
      window.__yage__.inspector.getSceneStack().at(-1)?.name ===
        "isometric-workshop",
  );
  await drive(page, []);
}

test("isometric placement follows the floor grid, rotates furniture and rejects positions outside the diamond", async ({
  page,
}) => {
  await openIsometricView(page);
  expect((await state(page)).view).toBe("isometric");
  await drive(page, [
    { click: [80, 174] },
    { move: [536, 352] },
    { key: "KeyR" },
  ]);
  expect((await state(page)).preview?.ok).toBe(true);
  expect((await state(page)).previewTypes).toEqual(["chair"]);
  await drive(page, [{ move: [536, 352] }, { key: "Enter" }]);
  expect((await state(page)).layoutState.objects.at(-1)).toMatchObject({
    type: "chair",
    pose: { x: 224, y: 224, rotation: Math.PI / 2 },
  });
  await drive(page, [{ click: [80, 174] }, { move: [800, 160] }]);
  expect(
    (await state(page)).preview?.issues.some((i) => i.code === "outside-area"),
  ).toBe(true);
});

test("isometric placement picks raised artwork and carries tabletop objects when moving a table", async ({
  page,
}) => {
  await openIsometricView(page);
  await drive(page, [{ click: [80, 222] }, { move: [570.6410161513776, 260] }]);
  expect(
    (await state(page)).preview?.issues.some((i) => i.code === "surface"),
  ).toBe(true);
  await drive(page, [{ move: [570.6410161513776, 220] }, { key: "Enter" }]);
  expect((await state(page)).layoutState.objects.at(-1)?.attachment).toEqual({
    parent: "p1",
    socket: "top",
  });
  // Both lamps cover this pixel. The later lamp is painted in front.
  await drive(page, [{ click: [566, 175] }]);
  expect(
    await page.evaluate(() =>
      window.__yage__!.inspector.getComponentData(
        "RoomEditorEntity",
        "PlacementController",
      ),
    ),
  ).toMatchObject({ inspection: { command: { kind: "move", id: "p5" } } });
  await drive(page, [{ key: "Escape" }]);
  const beforeClick = (await state(page)).layoutState;
  await drive(page, [{ click: [512, 198] }, { click: [512, 198] }]);
  expect((await state(page)).layoutState).toEqual(beforeClick);
  await drive(page, [{ click: [512, 198] }, { move: [549.856406460551, 376] }]);
  expect((await state(page)).previewTypes.sort()).toEqual([
    "lamp",
    "lamp",
    "table",
  ]);
  expect((await state(page)).preview?.ok).toBe(true);
  await drive(page, [{ move: [549.856406460551, 376] }, { key: "Enter" }]);
  expect((await state(page)).poses.p1).toMatchObject({ x: 256, y: 240 });
  expect((await state(page)).poses.p2).toMatchObject({ x: 256, y: 240 });
  await drive(page, [{ key: "KeyZ" }]);
  expect((await state(page)).poses.p1).toMatchObject({ x: 128, y: 112 });
  expect(
    await page.evaluate(() => window.__yage__!.inspector.getErrors()),
  ).toMatchObject({ callbackErrors: [] });
});

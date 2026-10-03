import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type {} from "@yagejs/core";
interface Probe {
  width: number;
  height: number;
  x: number;
  y: number;
  opacity: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  events: { name: string; x: number; y: number; rotation: number }[];
}
async function probes(page: Page): Promise<Probe[]> {
  return page.evaluate(() => {
    const i = window.__yage__!.inspector;
    return i
      .getEntities()
      .filter((e) => e.components.includes("ActorProbe"))
      .map((e) => i.getComponentData(e.id, "ActorProbe") as Probe);
  });
}
async function boot(page: Page) {
  await page.goto("/?test");
  await page
    .getByTestId("level-picker")
    .selectOption("src/sequence/entrance.yage-sequence-workspace.json");
  await expect(page.getByTestId("sequence-panel")).toBeVisible();
  await page.waitForFunction(
    () =>
      window.__yage__?.inspector
        .getEntities()
        .filter((e) => e.components.includes("ActorProbe")).length === 2,
  );
  await page.evaluate(() => window.__yage__!.inspector.time.thaw());
}
async function frame(page: Page, n: number) {
  await page.getByLabel("Cursor frame", { exact: true }).fill(String(n));
}
async function step(page: Page, n: number) {
  await page.evaluate(
    (count) => window.__yage__!.inspector.time.step(count),
    n,
  );
}
async function undo(page: Page) {
  const button = page.getByTestId("undo");
  await expect(button).toBeEnabled();
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/draft/undo")),
    button.click(),
  ]);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
}
async function clip(page: Page) {
  const settings = page.getByText("Settings", { exact: true });
  if (
    !(await page.getByLabel("Runtime clip JSON", { exact: true }).isVisible())
  )
    await settings.click();
  return JSON.parse(
    await page.getByLabel("Runtime clip JSON", { exact: true }).inputValue(),
  ) as {
    tracks: {
      id: string;
      target: string;
      property: string;
      keys: { id: string; frame: number; value: unknown }[];
    }[];
    events: unknown[];
    targets: Record<string, unknown>;
  };
}
test.describe.configure({ mode: "serial" });
test.afterEach(async ({ page }) => {
  if (new URL(page.url()).pathname === "/") {
    const u = page.getByTestId("undo");
    for (let n = 0; n < 30 && (await u.isEnabled()); n++) {
      await undo(page);
      await expect(page.getByTestId("save-level")).toBeVisible();
    }
  }
});

test("two declared entities sample easing and both mappings without changing actor dimensions", async ({
  page,
}) => {
  await boot(page);
  await frame(page, 22.5);
  let [a, b] = await probes(page);
  expect(a!.x).toBeCloseTo(157.5);
  expect(a!.opacity).toBeCloseTo(0.75);
  expect(b!.x).toBeCloseTo(620);
  await frame(page, 75);
  [a, b] = await probes(page);
  expect(a!.x).toBeCloseTo(270);
  expect(a!.rotation).toBeCloseTo(0.25);
  expect(b!.x).toBeCloseTo(500);
  expect(a!.events).toEqual([]);
  await page.getByText("Settings", { exact: true }).click();
  await page.getByLabel("Preview width", { exact: true }).fill("320");
  await page.getByLabel("Preview height", { exact: true }).fill("480");
  await frame(page, 45);
  [a, b] = await probes(page);
  expect(a!.x).toBeCloseTo(110);
  expect(b!.x).toBeCloseTo(220);
  expect([a!.width, a!.height, a!.scaleX, a!.scaleY]).toEqual([48, 68, 1, 1]);
  expect([b!.width, b!.height, b!.scaleX, b!.scaleY]).toEqual([72, 48, 1, 1]);
});
test("scrubbing and key retiming update before release and commit one undo step", async ({
  page,
}) => {
  await boot(page);
  const ruler = await page.getByTestId("sequence-ruler").boundingBox();
  await page.mouse.move(ruler!.x + ruler!.width * 0.25, ruler!.y + 12);
  await page.mouse.down();
  await page.mouse.move(ruler!.x + ruler!.width * 0.5, ruler!.y + 12, {
    steps: 4,
  });
  await expect(page.getByLabel("Cursor frame", { exact: true })).toHaveValue(
    "60.0",
  );
  await expect.poll(async () => (await probes(page))[0]?.x).toBeCloseTo(220);
  await page.mouse.up();
  await frame(page, 75.5);
  const before = (await probes(page))[0]!.x;
  const key = page.getByRole("button", {
    name: "actorA position frame 90",
    exact: true,
  });
  const box = await key.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width / 2 + (ruler!.width * 10) / 120,
    box!.y + box!.height / 2,
    { steps: 5 },
  );
  await expect(
    page.getByRole("button", {
      name: "actorA position frame 100",
      exact: true,
    }),
  ).toBeVisible();
  expect((await probes(page))[0]!.x).not.toBeCloseTo(before);
  await page.mouse.up();
  await undo(page);
  await expect(
    page.getByRole("button", { name: "actorA position frame 90", exact: true }),
  ).toBeVisible();
  expect((await probes(page))[0]!.x).toBeCloseTo(before);
});
test("existing transform controls key the cursor, with undo and preview type replacement", async ({
  page,
}) => {
  await boot(page);
  await frame(page, 60);
  await page
    .getByRole("button", { name: "actorA · position", exact: true })
    .click();
  await expect(page.getByTestId("game-section")).toHaveCount(0);
  const x = page.getByLabel("X", { exact: true });
  await x.fill("300");
  await x.press("Enter");
  expect((await probes(page))[0]!.x).toBeCloseTo(300);
  const data = await clip(page);
  expect(
    data.tracks
      .find((t) => t.target === "actorA" && t.property === "position")
      ?.keys.find((k) => k.frame === 60)?.value,
  ).toEqual({ x: 300, y: 270 });
  await page.getByText("Settings", { exact: true }).click();
  await undo(page);
  await expect.poll(async () => (await probes(page))[0]?.x).toBeCloseTo(220);
  await page
    .getByLabel("Preview entity", { exact: true })
    .selectOption("yage.sequence-placeholder");
  await expect.poll(async () => (await probes(page)).length).toBe(1);
  await expect(page.getByLabel("Runtime slot", { exact: true })).toHaveValue(
    "actorA",
  );
  expect(
    (await clip(page)).tracks.filter((t) => t.target === "actorA"),
  ).toHaveLength(3);
  await page.getByText("Settings", { exact: true }).click();
  await undo(page);
  await expect.poll(async () => (await probes(page)).length).toBe(2);
});
test("actors come from the shared catalog and removal restores through shared history", async ({
  page,
}) => {
  await boot(page);
  await page
    .getByRole("button", { name: "Add placeholder actor", exact: true })
    .click();
  await expect(page.getByLabel("Runtime slot", { exact: true })).toHaveValue(
    "sequence-placeholder",
  );
  expect(Object.keys((await clip(page)).targets)).toHaveLength(3);
  await page.getByText("Settings", { exact: true }).click();
  await page.getByTestId("delete-selection").click();
  expect(Object.keys((await clip(page)).targets)).toHaveLength(2);
  await page.getByText("Settings", { exact: true }).click();
  await undo(page);
  expect(Object.keys((await clip(page)).targets)).toHaveLength(3);
});
test("preview logs markers while game event handlers stay dormant", async ({
  page,
}) => {
  await boot(page);
  await page.evaluate(() => window.__yage__!.inspector.time.freeze());
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByTestId("sequence-play").click();
  await step(page, 241);
  await expect(page.getByText("Event log (4)", { exact: true })).toBeVisible();
  for (const p of await probes(page)) expect(p.events).toEqual([]);
  await expect(page.getByTestId("sequence-play")).toHaveText("Play");
});
test("anchored key insertion preserves the preview and discrete tracks have valid defaults", async ({
  page,
}) => {
  await boot(page);
  await frame(page, 75);
  await page
    .getByRole("button", { name: "actorB · position", exact: true })
    .click();
  const before = (await probes(page))[1]!;
  await page
    .getByRole("button", { name: "Add key at cursor", exact: true })
    .click();
  await expect
    .poll(async () => (await probes(page))[1]?.x)
    .toBeCloseTo(before.x);
  await page
    .getByLabel("Add property track", { exact: true })
    .selectOption("visible");
  expect(
    (await clip(page)).tracks.find(
      (t) => t.target === "actorB" && t.property === "visible",
    )?.keys[0]?.value,
  ).toBe(true);
});
test("authors typed values, Bezier easing and contract properties without JSON", async ({
  page,
}) => {
  await boot(page);
  await frame(page, 75);
  await page
    .getByRole("button", { name: "actorA · position", exact: true })
    .click();
  await page.getByLabel("Key value X", { exact: true }).fill("-50");
  await page.getByLabel("Key value X", { exact: true }).press("Enter");
  await page.getByLabel("Key easing", { exact: true }).selectOption("bezier");
  await page.getByLabel("Bezier X1", { exact: true }).fill("0.4");
  await page.getByLabel("Bezier X1", { exact: true }).press("Enter");
  await expect(
    page.getByRole("img", { name: "Bezier easing curve" }),
  ).toBeVisible();
  await page.getByText("Actor contract", { exact: true }).click();
  await page.getByLabel("Property name", { exact: true }).fill("mood");
  await page.getByLabel("Property kind", { exact: true }).selectOption("enum");
  await page.getByRole("button", { name: "Add property", exact: true }).click();
  await page
    .getByLabel("Add property track", { exact: true })
    .selectOption("mood");
  await page
    .getByRole("button", { name: "actorA · mood", exact: true })
    .click();
  await page.getByLabel("Key value", { exact: true }).selectOption("walk");
  await expect(page.getByLabel("Key easing", { exact: true })).toHaveValue(
    "hold",
  );
  await page.getByRole("button", { name: "Remove track", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "actorA · mood", exact: true }),
  ).toHaveCount(0);
  await undo(page);
  await expect(
    page.getByRole("button", { name: "actorA · mood", exact: true }),
  ).toBeVisible();
});
test("authors event payloads and retimes markers live", async ({ page }) => {
  await boot(page);
  await frame(page, 30);
  await page
    .getByRole("button", { name: "actorA · position", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add event at cursor", exact: true })
    .click();
  await page.getByLabel("Payload name", { exact: true }).selectOption("ready");
  await page.getByLabel("Event frame", { exact: true }).fill("35");
  await page.getByLabel("Event frame", { exact: true }).press("Enter");
  const marker = page.getByRole("button", {
    name: "actorA gesture event frame 35",
    exact: true,
  });
  const b = await marker.boundingBox();
  const ruler = await page.getByTestId("sequence-ruler").boundingBox();
  await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    b!.x + b!.width / 2 + ruler!.width / 12,
    b!.y + b!.height / 2,
    { steps: 5 },
  );
  await expect(page.getByTestId("sequence-drag-frame")).toHaveText("Frame 45");
  await expect(page.getByLabel("Event frame", { exact: true })).toHaveValue(
    "45",
  );
  await page.mouse.up();
  await undo(page);
  await expect(page.getByLabel("Event frame", { exact: true })).toHaveValue(
    "35",
  );
  await page.getByRole("button", { name: "Delete event", exact: true }).click();
  await expect(marker).toHaveCount(0);
});
test("exports accepted runtime data, imports it with undo, and rejects invalid files", async ({
  page,
}) => {
  await boot(page);
  const original = await clip(page);
  await page.getByText("Settings", { exact: true }).click();
  await page.getByText("Files", { exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export runtime clip", exact: true })
    .click();
  const download = await downloaded;
  const data = JSON.parse(
    await readFile((await download.path())!, "utf8"),
  ) as typeof original & { name: string };
  expect(data.tracks).toEqual(original.tracks);
  data.name = "Imported sequence";
  await page.getByLabel("Import sequence clip", { exact: true }).setInputFiles({
    name: "clip.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await expect(page.getByTestId("undo")).toBeEnabled();
  await page.getByText("Files", { exact: true }).click();
  await page.getByText("Settings", { exact: true }).click();
  await expect(page.getByLabel("Sequence name", { exact: true })).toHaveValue(
    "Imported sequence",
  );
  await page.getByText("Settings", { exact: true }).click();
  await undo(page);
  await page.getByText("Files", { exact: true }).click();
  await page.getByLabel("Import sequence clip", { exact: true }).setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"format":"invalid"}'),
  });
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByTestId("undo")).toBeDisabled();
});
test("deleted key selection does not poison the next drag, and mapping switches keep the pose", async ({
  page,
}) => {
  await boot(page);
  await frame(page, 75);
  await page
    .getByRole("button", { name: "actorA position frame 60", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete key", exact: true }).click();
  const key = page.getByRole("button", {
    name: "actorA position frame 90",
    exact: true,
  });
  const box = await key.boundingBox(),
    ruler = await page.getByTestId("sequence-ruler").boundingBox();
  await page.keyboard.down("Shift");
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width / 2 + ruler!.width / 12,
    box!.y + box!.height / 2,
    { steps: 4 },
  );
  await expect(page.getByTestId("sequence-drag-frame")).toHaveText("Frame 100");
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(page.getByRole("alert")).toHaveCount(0);
  const before = (await probes(page))[0]!;
  await page
    .getByLabel("Position mode", { exact: true })
    .selectOption("anchored");
  await expect
    .poll(async () => (await probes(page))[0]?.x)
    .toBeCloseTo(before.x);
  await expect
    .poll(async () => (await probes(page))[0]?.y)
    .toBeCloseTo(before.y);
});
test("the same saved workspace plays on runtime targets with typed event consequences", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("/sequence.html?test");
  await page.waitForFunction(() => window.__yage__?.inspector?.time.isFrozen());
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await step(page, 240);
  const [a, b] = await probes(page);
  expect(a!.events.map((e) => e.name)).toEqual(["hello", "ready"]);
  expect(b!.events.map((e) => e.name)).toEqual(["hello", "ready"]);
  expect(a!.events[0]!.x).toBeCloseTo(348.75);
  expect(b!.events[0]).toMatchObject({ x: 760, y: 310 });
  expect(a!.x).toBeCloseTo(585);
  expect(b!.x).toBeCloseTo(800);
  expect(
    requests.filter(
      (u) => u.includes("editor/dist/browser") || u.includes("sequence-editor"),
    ),
  ).toEqual([]);
});

test("the sequence authored from a blank workspace loads into the game", async ({
  page,
}) => {
  await page.goto("/sequence.html?test");
  await page.waitForFunction(() => window.__yage__?.inspector?.time.isFrozen());
  await page.getByLabel("Play saved sequence", { exact: true }).setInputFiles({
    name: "Curtain call.yage-sequence-workspace.json",
    mimeType: "application/json",
    buffer: await readFile(
      new URL(
        "../../examples/src/sequence/Curtain call.yage-sequence-workspace.json",
        import.meta.url,
      ),
    ),
  });
  await expect(page.getByRole("alert")).toHaveText(
    "Sequence loaded with runtime actor bindings",
  );
  await step(page, 240);
  const [a, b] = await probes(page);
  expect(a!.events.map((event) => event.name)).toEqual(["hello"]);
  expect(b!.events.map((event) => event.name)).toEqual(["ready"]);
  expect(a!.events[0]!.x).toBeCloseTo(410);
  expect(b!.events[0]!.x).toBeCloseTo(360);
  expect(a!.x).toBeCloseTo(620);
  expect(a!.rotation).toBeCloseTo(Math.PI / 4);
  expect(b!.x).toBeCloseTo(360);
  expect(b!.rotation).toBeCloseTo(-Math.PI / 6);
  expect([a!.width, a!.height, a!.scaleX]).toEqual([48, 68, 1]);
  expect([b!.width, b!.height, b!.scaleX]).toEqual([72, 48, 1.4]);
});

test("coincident event flags can each be selected and dragged", async ({
  page,
}) => {
  await boot(page);
  const a = page.getByRole("button", {
    name: "actorA gesture event frame 120",
    exact: true,
  });
  const b = page.getByRole("button", {
    name: "actorB gesture event frame 120",
    exact: true,
  });
  await a.scrollIntoViewIfNeeded();
  const ab = (await a.boundingBox())!;
  const bb = (await b.boundingBox())!;
  expect(Math.abs(ab.y - bb.y)).toBeGreaterThanOrEqual(ab.height);
  for (const actor of ["actorA", "actorB"]) {
    const marker = page.getByRole("button", {
      name: `${actor} gesture event frame 120`,
      exact: true,
    });
    await marker.scrollIntoViewIfNeeded();
    const box = (await marker.boundingBox())!;
    const ruler = (await page.getByTestId("sequence-ruler").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 - ruler.width / 12,
      box.y + box.height / 2,
      { steps: 5 },
    );
    await expect(page.getByLabel("Event frame", { exact: true })).toHaveValue(
      "110",
    );
    await page.mouse.up();
    await expect(
      page.getByRole("button", {
        name: `${actor} gesture event frame 110`,
        exact: true,
      }),
    ).toBeVisible();
    await undo(page);
    await expect(marker).toBeVisible();
  }
});

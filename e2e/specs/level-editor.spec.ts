import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { waitForInspector } from "./helpers.js";

/**
 * The level editor, end to end: open a level, build it from the Actors strip,
 * drag, delete, edit a parameter, move a placement in the hierarchy, take edits
 * back, save, and load the saved file in a game page.
 *
 * One `yage-editor` server on :5201 serves the editor, its play page, and the
 * project's own game page. That one server holds every draft, so these tests
 * run in order and each takes a level file of its own.
 */

const LEVELS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../editor-project/levels",
);
const TEMPLATE = path.join(LEVELS, "forest.template.json");
const STALE_TEMPLATE = path.join(LEVELS, "forest-stale.template.json");
/**
 * The same three placements, with the root turned a third of a half-turn and
 * mirrored on x. A parent that both turns and mirrors is where a pose computed
 * in world space and stored in the parent's space can come back reflected: the
 * two corrections cancel on an upright parent and on a mirrored one, and only
 * disagree when both apply.
 */
const TURNED_TEMPLATE = path.join(LEVELS, "forest-turned.template.json");
/**
 * One placement authored at a scale of zero — where a placement that pops in
 * under an animation starts, and the state no factor can leave.
 */
const FLAT_TEMPLATE = path.join(LEVELS, "forest-flat.template.json");
const FLAT = "01J00000000000000000FLAT01";
const FLAT_POSITION: Point = { x: -120, y: -80 };
/** What that template turns and mirrors the root by. */
const TURNED_ROTATION = Math.PI / 3;

/**
 * The three placements `forest.template.json` authors: a root, its child, and
 * a later root. Their poses are far enough apart that a press on one reaches
 * no other, and all three sit inside the one view the editor has.
 */
const ROOT = "01J0000000000000000000ROOT";
const CHILD = "01J000000000000000000CHILD";
const LATER = "01J000000000000000000LATER";
/** Where the template puts each of them in the world. */
const AUTHORED: Record<string, Point> = {
  [ROOT]: { x: -200, y: -150 },
  [CHILD]: { x: -100, y: 0 },
  [LATER]: { x: 250, y: 150 },
};
/** What the template authors each of them with. */
const SPRITES: Record<string, string> = {
  [ROOT]: "assets/player_idle.png",
  [CHILD]: "assets/skeleton_idle.png",
  [LATER]: "assets/player_jump.png",
};
/** The asset the gate's parameter edit puts on the child. */
const EDITED_SPRITE = "assets/player_walk.png";
/**
 * The asset the picker offers and this path chooses. It lives under the Vite
 * root, which is what the listing walks — the fixture's other textures sit in
 * a `publicDir` outside it and are typed by hand.
 */
const PICKED_SPRITE = "sprites/barrel.png";
/** The fixture's asset directory, which the `assets` glob matches. */
const SPRITE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../editor-project/sprites",
);
/** A sprite written while the editor is running, and removed again. */
const ADDED_SPRITE = "sprites/added.png";

/**
 * How far above a placement's origin its row of marks sits, in screen pixels.
 * The editor lays the row out in screen pixels, so this is a client-pixel
 * offset from wherever the origin lands on the page.
 */
const MARK_OFFSET = 18;

/** Where the template puts a placement, by id. */
function authored(id: string): Point {
  const point = AUTHORED[id];
  if (!point) throw new Error(`the template has no placement ${id}`);
  return point;
}

/** What the template authors a placement with, by id. */
function spriteOf(id: string): string {
  const sprite = SPRITES[id];
  if (!sprite) throw new Error(`the template has no placement ${id}`);
  return sprite;
}

/**
 * A second level for the picker, with one placement at a position no other
 * template uses — so "which level am I looking at" is one assertion.
 */
const MEADOW_TEMPLATE = path.join(LEVELS, "meadow.template.json");
const MEADOW = "01J000000000000000MEADOW01";
const MEADOW_POSITION: Point = { x: 240, y: 40 };

/** The two placements `forest-stale.template.json` authors. */
const STALE = "01J000000000000000000STALE";
const MISSING = "01J00000000000000000ABSENT";

/** What the fixture `Slime` declares its relative `patrolEnd` default as. */
const SLIME_PATROL_END: Point = { x: 120, y: 0 };

const API = "/__yage_editor/api/v1";
const TOKEN_HEADER = "x-yage-editor-token";

/** What `e2e/editor-project/lab/harness.ts` puts on the page for this path. */
interface EditorTestHooks {
  /** The size the renderer draws at, in virtual pixels. */
  readonly view: { width: number; height: number };
  canvasToVirtual(x: number, y: number): Point;
  virtualToCanvas(x: number, y: number): Point;
}

/** What `e2e/editor-project/src/inspect.ts` reports about one placement. */
interface PlacementFact {
  /** The placement's `key` when it authored one, and its `id` when it did not. */
  readonly sceneId: string;
  readonly sprite: string;
  /** The render layer the placement's sprite is parented to. */
  readonly layer: string;
  readonly parent?: string;
  /** Whether the entity is switched on, which a dormant preview never is. */
  readonly active: boolean;
  readonly world: Point;
  readonly rotation: number;
  readonly scale: Point;
}

/** What the same extension reports about one switch's reference parameters. */
interface SwitchFact {
  readonly sceneId: string;
  /** The scene id the `door` handle resolves to, `null` once it is gone. */
  readonly door: string | null;
  readonly chime: string | null;
}

/** What the same extension reports about one slime's decoded parameters. */
interface SlimeFact {
  readonly sceneId: string;
  /**
   * Every parameter as `setup()` received it, with each `Vec2` written as its
   * two numbers in an array and a value an optional field holds nothing for as
   * `null`.
   */
  readonly params: Readonly<Record<string, unknown>>;
}

interface Point {
  x: number;
  y: number;
}

/** As much of a placement as this path reads out of a draft. */
interface DraftPlacement {
  id: string;
  type: string;
  name?: string;
  key?: string;
  parent?: string;
  layer?: string;
  /** Left out by the canonical format while it holds its default of `true`. */
  active?: boolean;
  typeVersion: number;
  transform: { position: Point };
  params: Record<string, unknown>;
}

/** As much of a draft snapshot as this path reads. */
interface DraftView {
  draftRevision: number;
  document: { entities: DraftPlacement[] };
  history: { undoDepth: number; redoDepth: number };
}

/** What every write route answers. */
interface DraftOutcomeView {
  status: string;
  snapshot: DraftView;
}

/** The level this test is editing, project-relative. */
let level = "";
let levelCount = 0;

/**
 * One level file, new for each test.
 *
 * The name is new because the server keeps one draft per path for as long as
 * it runs: reusing a name would hand the next test the edits of the last one.
 * It is the only one because the editor opens the first level the server lists,
 * which is also how a test picks the template it wants.
 */
function useTemplate(template: string): void {
  for (const file of readdirSync(LEVELS)) {
    if (file.endsWith(".yage-level.json")) rmSync(path.join(LEVELS, file));
  }
  levelCount += 1;
  level = `levels/forest-${String(levelCount)}.yage-level.json`;
  copyFileSync(template, path.join(LEVELS, path.basename(level)));
}

/** The level the picker switches to, when a test asks for a second one. */
let secondLevel = "";

/**
 * Write a second level beside the first, for the cases about the picker.
 *
 * It runs after {@link useTemplate} has cleared the directory and before the
 * page is opened, because the server lists the levels once, at bootstrap.
 * `forest` sorts before `meadow`, so the editor still opens the forest level.
 */
function useSecondLevel(): void {
  secondLevel = `levels/meadow-${String(levelCount)}.yage-level.json`;
  copyFileSync(MEADOW_TEMPLATE, path.join(LEVELS, path.basename(secondLevel)));
}

test.beforeEach(() => {
  useTemplate(TEMPLATE);
  secondLevel = "";
});

/**
 * Every placement the file on disk holds, in authored order. A placement at
 * the identity transform carries no `transform`: the canonical format leaves
 * out a field holding its default.
 *
 * `from` names the level to read, and defaults to the one the test opened —
 * a case that edits the second level says which file it means.
 */
function savedPlacements(from: string = level): DraftPlacement[] {
  const file = path.join(LEVELS, path.basename(from));
  const document = JSON.parse(readFileSync(file, "utf8")) as {
    entities: (Omit<DraftPlacement, "transform"> & {
      transform?: { position: Point };
    })[];
  };
  return document.entities.map((entity) => ({
    ...entity,
    transform: { position: entity.transform?.position ?? { x: 0, y: 0 } },
  }));
}

/**
 * One placement's whole transform as the file on disk holds it. The canonical
 * format leaves out a field holding its default, so each part has one.
 */
function savedTransform(
  id: string,
  from: string = level,
): {
  position: Point;
  rotation: number;
  scale: Point;
} {
  const file = path.join(LEVELS, path.basename(from));
  const document = JSON.parse(readFileSync(file, "utf8")) as {
    entities: {
      id: string;
      transform?: {
        position?: Point;
        rotation?: number;
        scale?: Point;
      };
    }[];
  };
  const found = document.entities.find((entity) => entity.id === id);
  if (!found) throw new Error(`${from} has no placement ${id}.`);
  return {
    position: found.transform?.position ?? { x: 0, y: 0 },
    rotation: found.transform?.rotation ?? 0,
    scale: found.transform?.scale ?? { x: 1, y: 1 },
  };
}

/** One placement as the file on disk holds it. */
function savedPlacement(id: string, from: string = level): DraftPlacement {
  const found = savedPlacements(from).find((placement) => placement.id === id);
  if (!found) throw new Error(`${from} has no placement ${id}.`);
  return found;
}

/** The token the page was served with, which every editor request carries. */
async function tokenOf(page: Page): Promise<string> {
  const token = await page
    .locator('meta[name="yage-editor-token"]')
    .getAttribute("content");
  if (!token) throw new Error("the page carries no editor token");
  return token;
}

/**
 * The editor, with its level open and projected.
 *
 * The preview holds the editor camera from the moment the scene enters; the
 * placements join it once the level is projected, which is what a drag needs.
 * A level whose placements cannot load projects none, and that is what the
 * stale-schema path passes an empty list for.
 */
async function openEditor(
  page: Page,
  drawn: readonly string[] = authoredLines(),
): Promise<void> {
  await openEditorPage(page);
  await expectPlacements(page, drawn);
}

/**
 * The same, without saying what it drew — for a level whose expected world
 * poses are what the test is there to work out.
 */
async function openEditorPage(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("level-picker")).toHaveValue(level);
  await waitForInspector(page);
}

/**
 * Open the Actors strip under the viewport, which starts closed so the
 * viewport keeps the height.
 *
 * The strip takes that height back from the canvas, and the canvas reaches the
 * view through a resize observer — so this returns once the picture has
 * settled, and a case that reads the camera afterwards reads the new one.
 */
async function openActors(page: Page): Promise<void> {
  const tall = await canvasHeight(page);
  await page.getByTestId("actors-toggle").click();
  await expect(page.getByTestId("actors-toggle")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect.poll(() => canvasHeight(page)).toBeLessThan(tall);
}

/** The lattice the toolbar is showing, in world units. */
async function gridStep(page: Page): Promise<number> {
  const shown = await page.getByTestId("grid-step").inputValue();
  const step = Number(shown);
  if (!(step > 0)) throw new Error(`the toolbar shows no step: ${shown}`);
  return step;
}

/**
 * Switch snapping off, which the editor ships with on.
 *
 * A case that asserts where a pointer put something is asserting the
 * conversion from client pixels to world units, and a lattice would round the
 * answer to itself and pass whatever the conversion did. The cases that are
 * about the lattice leave it alone.
 */
async function withoutSnapping(page: Page): Promise<void> {
  await page.getByTestId("toggle-snap").click();
  await expect(page.getByTestId("toggle-snap")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
}

/**
 * What the page has loaded, in the order it created the entities.
 *
 * Every placement is a `Crate`, so the scene gives them one name and
 * `getEntities()` cannot tell them apart. The fixture project's Inspector
 * extension can: it reports each placement's id, the asset it was authored
 * with, its runtime parent, and where the parent chain put it.
 */
async function placementsIn(page: Page): Promise<PlacementFact[]> {
  return page.evaluate(() => {
    const facts = window.__yage__?.inspector.getExtension<{
      placements(): PlacementFact[];
    }>("levelFixture");
    return facts ? facts.placements() : [];
  });
}

/**
 * Every switch the page loaded, and the scene id each of its two reference
 * parameters resolved to.
 *
 * The document only proves that an id was stored. This is what says the loader
 * handed `setup()` a handle on the entity that id named.
 */
async function switchesIn(page: Page): Promise<SwitchFact[]> {
  return page.evaluate(() => {
    const facts = window.__yage__?.inspector.getExtension<{
      switches(): SwitchFact[];
    }>("levelFixture");
    return facts ? facts.switches() : [];
  });
}

/**
 * One line per placement — order, id, asset, parent, world position — which is
 * what most of these tests compare a whole level against in one assertion.
 *
 * Rotation and scale are left out on purpose. Only the gizmo cases change
 * them, and each of those says which placement it turned or scaled; carrying
 * them here would put two more numbers in every unrelated expectation.
 */
function factLines(facts: readonly PlacementFact[]): string[] {
  return facts.map(
    (fact) =>
      `${fact.sceneId} ${fact.sprite} parent=${fact.parent ?? "-"} ` +
      `${fixed(fact.world.x)},${fixed(fact.world.y)}`,
  );
}

/** One expected placement, as {@link factLines} writes it. */
function factLine(
  id: string,
  world: Point,
  options: { sprite?: string; parent?: string } = {},
): string {
  return (
    `${id} ${options.sprite ?? spriteOf(id)} ` +
    `parent=${options.parent ?? "-"} ${fixed(world.x)},${fixed(world.y)}`
  );
}

/**
 * One placement the page has loaded, once it is there.
 *
 * The wait is what keeps the comparison honest: a placement that has not
 * arrived yet reports nothing, and "nothing" differs from every expected value
 * an assertion could name.
 */
async function placementIn(page: Page, id: string): Promise<PlacementFact> {
  let found: PlacementFact | undefined;
  await expect
    .poll(
      async () => {
        found = (await placementsIn(page)).find((fact) => fact.sceneId === id);
        return found !== undefined;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  if (!found) throw new Error(`the page has no placement ${id}`);
  return found;
}

/**
 * Wait until the page draws exactly these placements.
 *
 * A rebuild is asynchronous — the preview reloads assets and replaces the
 * scene's entities — so every assertion about what is drawn polls rather than
 * reading once.
 */
async function expectPlacements(
  page: Page,
  expected: readonly string[],
): Promise<void> {
  await expect
    .poll(async () => factLines(await placementsIn(page)), { timeout: 10_000 })
    .toEqual(expected);
}

/** The three placements as the template authors them. */
function authoredLines(): string[] {
  return [
    factLine(ROOT, authored(ROOT)),
    factLine(CHILD, authored(CHILD), { parent: ROOT }),
    factLine(LATER, authored(LATER)),
  ];
}

/**
 * Where a world position is on the page, in client pixels.
 *
 * Three spaces stand between a world coordinate and a pointer: the camera puts
 * the world in the renderer's virtual pixels, the fit puts those on the canvas,
 * and the canvas sits somewhere in the page. The camera is read rather than
 * assumed, because the editor's view moves; the harness hands over the fit.
 */
async function clientPointOf(page: Page, world: Point): Promise<Point> {
  const camera = await editorCamera(page);
  const canvas = await canvasBox(page);
  const onCanvas = await page.evaluate(
    ({ point, view }) => {
      const test = (window as unknown as { __editorTest__?: EditorTestHooks })
        .__editorTest__;
      if (!test) throw new Error("the harness exposed no test hooks");
      return test.virtualToCanvas(
        (point.x - view.position.x) * view.zoom + test.view.width / 2,
        (point.y - view.position.y) * view.zoom + test.view.height / 2,
      );
    },
    { point: world, view: camera },
  );
  return { x: canvas.x + onCanvas.x, y: canvas.y + onCanvas.y };
}

/**
 * Where the editor camera is, which every world-to-client conversion here
 * goes through.
 *
 * Rotation is asserted rather than read: nothing in the editor turns the
 * camera, and the conversions above are written for an upright one.
 */
async function editorCamera(
  page: Page,
): Promise<{ position: Point; zoom: number }> {
  const camera = await page.evaluate(
    () => window.__yage__?.inspector.snapshot().camera,
  );
  expect(camera).toMatchObject({ rotation: 0 });
  if (!camera) throw new Error("the preview has no camera");
  return { position: camera.position, zoom: camera.zoom };
}

async function canvasBox(
  page: Page,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page
    .getByTestId("yage-editor-viewport")
    .locator("canvas")
    .boundingBox();
  if (!box) throw new Error("the preview canvas has no box");
  return box;
}

/**
 * How tall the preview canvas is. A panel opening under the viewport takes its
 * height from this, and the resize reaches the view through an observer — so a
 * case that opens one waits on this before reading where the level is drawn.
 */
async function canvasHeight(page: Page): Promise<number> {
  return (await canvasBox(page)).height;
}

/** How tall a panel is, in client pixels. */
async function panelHeight(page: Page, testId: string): Promise<number> {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`the ${testId} panel has no box`);
  return box.height;
}

/** Press on a world point and drag by a client-pixel delta. */
async function dragFrom(page: Page, world: Point, by: Point): Promise<void> {
  const from = await clientPointOf(page, world);

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + by.x / 2, from.y + by.y / 2);
  await page.mouse.move(from.x + by.x, from.y + by.y);
  await page.mouse.up();
}

/** Drag one placement by a client-pixel delta, pressing where it is drawn. */
async function dragPlacement(page: Page, id: string, by: Point): Promise<void> {
  const facts = await placementsIn(page);
  const fact = facts.find((one) => one.sceneId === id);
  if (!fact) throw new Error(`the preview has no placement ${id}`);
  await dragFrom(page, fact.world, by);
}

/**
 * The world distance a client-pixel drag should cover.
 *
 * The canvas is laid out at whatever size the editor's viewport gives it while
 * the renderer keeps drawing in its own virtual pixels, so a drag measured in
 * client pixels is a different distance in the world. Asking the renderer for
 * that mapping is what makes the assertion a coordinate rather than "it moved":
 * an editor that passed raw client pixels to the camera — the defect this path
 * exists to catch — would land on the drag's own numbers instead.
 *
 * The zoom is the last step: a virtual pixel is a world unit only at zoom 1.
 */
async function expectedWorldDelta(page: Page, by: Point): Promise<Point> {
  const camera = await editorCamera(page);
  const virtual = await page.evaluate((delta) => {
    const test = (window as unknown as { __editorTest__?: EditorTestHooks })
      .__editorTest__;
    if (!test) throw new Error("the harness exposed no test hooks");
    const from = test.canvasToVirtual(0, 0);
    const to = test.canvasToVirtual(delta.x, delta.y);
    return { x: to.x - from.x, y: to.y - from.y };
  }, by);
  return { x: virtual.x / camera.zoom, y: virtual.y / camera.zoom };
}

function fixed(value: number): string {
  const text = value.toFixed(1);
  // A world coordinate that rounds to zero from below is still zero.
  return text === "-0.0" ? "0.0" : text;
}

/**
 * Every slime the page loaded and every parameter its `setup()` was handed.
 *
 * The document stores `patrolEnd` relative to the slime. This is what says the
 * level converted it through where the slime ended up, on the page that set
 * the entity up.
 */
async function slimesIn(page: Page): Promise<SlimeFact[]> {
  return page.evaluate(() => {
    const facts = window.__yage__?.inspector.getExtension<{
      slimes(): SlimeFact[];
    }>("levelFixture");
    return facts ? facts.slimes() : [];
  });
}

/**
 * The point a decoded `Vec2` crossed as, and nothing for any other value.
 *
 * The fixture writes a `Vec2` as its two numbers in an array and leaves a
 * plain object an object, so a parameter that stopped decoding to a `Vec2`
 * arrives here as something this cannot read.
 */
function decodedPoint(value: unknown): Point | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const [x, y] = value as readonly unknown[];
  if (typeof x !== "number" || typeof y !== "number") return undefined;
  return { x, y };
}

/** Waits for the page's one slime to have been set up with `target`. */
async function expectSlimeTarget(page: Page, target: Point): Promise<void> {
  await expect
    .poll(async () => {
      const [slime] = await slimesIn(page);
      const at = decodedPoint(slime?.params["patrolEnd"]);
      return at ? Math.hypot(at.x - target.x, at.y - target.y) < 0.5 : false;
    })
    .toBe(true);
}

function expectPoint(actual: Point | undefined, expected: Point): void {
  if (!actual) throw new Error("there is no position to compare.");
  expect(actual.x).toBeCloseTo(expected.x, 0);
  expect(actual.y).toBeCloseTo(expected.y, 0);
}

function offset(point: Point, by: Point): Point {
  return { x: point.x + by.x, y: point.y + by.y };
}

function placementOf(draft: DraftView, id: string): DraftPlacement {
  const found = draft.document.entities.find((entity) => entity.id === id);
  if (!found) throw new Error(`the draft has no placement ${id}`);
  return found;
}

function positionOf(draft: DraftView, id: string): Point {
  return placementOf(draft, id).transform.position;
}

function idsOf(draft: DraftView): string[] {
  return draft.document.entities.map((entity) => entity.id);
}

/** The draft the server holds, which is what a save promotes. */
async function draftOf(
  request: APIRequestContext,
  token: string,
  from: string = level,
): Promise<DraftView> {
  const outcome = await get<DraftOutcomeView>(
    request,
    `${API}/draft?path=${from}`,
    token,
  );
  expect(outcome.status).toBe("accepted");
  return outcome.snapshot;
}

/**
 * The draft, once its history holds what the editor's last action put there.
 *
 * The browser sends a write and answers the pointer before the server has
 * replied, so every assertion about the document waits for the history depths
 * the action produces. That wait is an assertion of its own: it is what says a
 * click in the Actors strip became one undoable edit rather than none or two.
 */
async function draftAfter(
  request: APIRequestContext,
  token: string,
  history: { undoDepth: number; redoDepth: number },
  from: string = level,
): Promise<DraftView> {
  let draft: DraftView | undefined;
  await expect
    .poll(
      async () => {
        draft = await draftOf(request, token, from);
        return draft.history;
      },
      { timeout: 10_000 },
    )
    .toEqual(history);
  if (!draft) throw new Error("the draft was never read.");
  return draft;
}

async function get<T>(
  request: APIRequestContext,
  route: string,
  token: string,
): Promise<T> {
  const response = await request.get(route, {
    headers: { [TOKEN_HEADER]: token },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as T;
}

async function post(
  request: APIRequestContext,
  route: string,
  token: string,
  data: unknown,
): Promise<DraftOutcomeView> {
  const response = await request.post(route, {
    headers: { [TOKEN_HEADER]: token },
    data,
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as DraftOutcomeView;
}

/**
 * How far from the anchor the rotate ring is, in client pixels, found by
 * walking outward until the cursor says the pointer is on it.
 *
 * The geometry is read from the running editor rather than imported or
 * written down: the ring's radius is a constant in `preview/gizmo.ts` that no
 * package entry exports, and a test carrying its own copy would keep passing
 * after the drawn ring moved. The cursor is what a developer aims by, so it
 * is what these tests aim by.
 */
async function ringRadius(page: Page, anchor: Point): Promise<number> {
  const viewport = page.getByTestId("yage-editor-viewport");
  for (let away = 4; away < 400; away += 1) {
    await page.mouse.move(anchor.x + away, anchor.y);
    const cursor = await viewport.evaluate((element) => element.style.cursor);
    if (cursor.startsWith("url(")) return away;
  }
  throw new Error("the rotate ring is nowhere along the x axis");
}

/**
 * The stretch of the scale gizmo's x arm that can be grabbed, in client pixels
 * from the anchor.
 *
 * A whole arm grabs, not only its tip, so this is a range rather than a point.
 * Which end of it a press lands on is the thing the case below is about.
 */
async function scaleArmReach(
  page: Page,
  anchor: Point,
): Promise<{ nearest: number; farthest: number }> {
  const viewport = page.getByTestId("yage-editor-viewport");
  let nearest = 0;
  let farthest = 0;
  for (let away = 4; away < 400; away += 1) {
    await page.mouse.move(anchor.x + away, anchor.y);
    const cursor = await viewport.evaluate((element) => element.style.cursor);
    if (cursor === "ew-resize") {
      if (nearest === 0) nearest = away;
      farthest = away;
    } else if (nearest > 0) {
      break;
    }
  }
  if (nearest === 0) throw new Error("the scale gizmo has no x arm");
  return { nearest, farthest };
}

/**
 * How far outside the box a press still turns the placement, in client pixels
 * from its centre: the last offset whose cursor is the rotate glyph.
 */
async function turnBandRadius(page: Page, centre: Point): Promise<number> {
  const viewport = page.getByTestId("yage-editor-viewport");
  let band = 0;
  for (let away = 4; away < 400; away += 1) {
    await page.mouse.move(centre.x, centre.y - away);
    const cursor = await viewport.evaluate((element) => element.style.cursor);
    if (cursor.startsWith("url(")) band = away;
    if (cursor === "grab" && band > 0) break;
  }
  if (band === 0) throw new Error("the box has no turn band above it");
  return band;
}

/**
 * The resize cursor found walking out from the anchor in one direction, or
 * `"none"` when nothing along it resizes.
 */
async function armCursorAlong(
  page: Page,
  anchor: Point,
  direction: Point,
): Promise<string> {
  const viewport = page.getByTestId("yage-editor-viewport");
  for (let away = 4; away < 200; away += 1) {
    await page.mouse.move(
      anchor.x + direction.x * away,
      anchor.y + direction.y * away,
    );
    const cursor = await viewport.evaluate((element) => element.style.cursor);
    if (cursor.endsWith("-resize")) return cursor;
  }
  return "none";
}

test.describe.configure({ mode: "serial" });

test.describe("level editor", () => {
  test("drags one placement, saves it, and the game page loads the file", async ({
    page,
    context,
  }) => {
    await openEditor(page);
    await withoutSnapping(page);
    const start = savedPlacement(ROOT).transform.position;
    expect(start).toEqual(AUTHORED[ROOT]);

    const drag = { x: 120, y: 80 };
    const expected = offset(start, await expectedWorldDelta(page, drag));
    await dragPlacement(page, ROOT, drag);
    await expect(page.getByTestId("dirty-marker")).toBeVisible();

    await page.getByTestId("save-level").click();
    await expect(page.getByTestId("dirty-marker")).toBeHidden();

    // The saved position is where the placement started plus the drag,
    // converted from client pixels to world units.
    const saved = savedPlacement(ROOT).transform.position;
    expectPoint(saved, expected);
    // The child is authored against its parent, so a parent that moved takes
    // it along without its own stored transform changing.
    expect(savedPlacement(CHILD).transform.position).toEqual({
      x: 100,
      y: 150,
    });

    // The saved file alone reproduces the level: this page is opened with no
    // run parameters, so it reads the JSON from disk.
    const game = await context.newPage();
    await game.goto(`/game.html?file=/${level}`);
    await waitForInspector(game);
    await expectPlacements(game, [
      factLine(ROOT, saved),
      factLine(CHILD, offset(saved, { x: 100, y: 150 }), { parent: ROOT }),
      factLine(LATER, authored(LATER)),
    ]);

    await expect(page.getByTestId("diagnostics")).toBeHidden();
  });

  test("switches levels, keeps the unsaved work, and saves it", async ({
    page,
    context,
  }) => {
    useSecondLevel();
    await openEditor(page);
    await withoutSnapping(page);

    const picker = page.getByTestId("level-picker");
    await expect(picker.locator("option")).toHaveText([level, secondLevel]);
    await expect(picker).toHaveValue(level);

    const start = savedPlacement(ROOT).transform.position;
    const drag = { x: 120, y: 80 };
    const expected = offset(start, await expectedWorldDelta(page, drag));
    await dragPlacement(page, ROOT, drag);
    await expect(page.getByTestId("dirty-marker")).toBeVisible();

    await picker.selectOption(secondLevel);
    await expect(picker).toHaveValue(secondLevel);
    // The other level, and only it: nothing from the one that was left is
    // still drawn.
    await expectPlacements(page, [
      factLine(MEADOW, MEADOW_POSITION, { sprite: "assets/player_idle.png" }),
    ]);
    await expect(page.getByTestId("dirty-marker")).toBeHidden();

    await picker.selectOption(level);
    await expect(picker).toHaveValue(level);
    // The server keeps one draft per level, so the drag is where it was left
    // and still unsaved.
    await expectPlacements(page, [
      factLine(ROOT, expected),
      factLine(CHILD, offset(expected, { x: 100, y: 150 }), { parent: ROOT }),
      factLine(LATER, authored(LATER)),
    ]);
    await expect(page.getByTestId("dirty-marker")).toBeVisible();

    await page.getByTestId("save-level").click();
    await expect(page.getByTestId("dirty-marker")).toBeHidden();
    const saved = savedPlacement(ROOT).transform.position;
    expectPoint(saved, expected);

    const game = await context.newPage();
    await game.goto(`/game.html?file=/${level}`);
    await waitForInspector(game);
    await expectPlacements(game, [
      factLine(ROOT, saved),
      factLine(CHILD, offset(saved, { x: 100, y: 150 }), { parent: ROOT }),
      factLine(LATER, authored(LATER)),
    ]);

    await expect(page.getByTestId("diagnostics")).toBeHidden();
  });

  test("picks a level, places on the grid, types, renames, and picks a sprite", async ({
    page,
    context,
    request,
  }) => {
    // The whole journey in one session on one placement: choose the level,
    // put a crate down where the grid says, type an angle, label it, choose
    // its sprite from what the project has, and load the saved file in a game
    // page.
    useSecondLevel();
    await openEditor(page);
    const token = await tokenOf(page);

    const picker = page.getByTestId("level-picker");
    await picker.selectOption(secondLevel);
    await expectPlacements(page, [
      factLine(MEADOW, MEADOW_POSITION, { sprite: "assets/player_idle.png" }),
    ]);

    // An Actors click creates at the middle of the view, and the middle of an
    // unmoved view is the origin — which is on every lattice. Panning first is
    // what makes a create that snapped distinguishable from one that did not.
    const from = await clientPointOf(page, MEADOW_POSITION);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(from.x + 180, from.y + 140);
    await page.mouse.up({ button: "middle" });

    // Before the centre is read: the strip takes its height from the viewport,
    // which moves the middle of the view without moving the picture.
    await openActors(page);
    const step = await gridStep(page);
    const centre = (await editorCamera(page)).position;
    const nearest = {
      x: Math.round(centre.x / step) * step,
      y: Math.round(centre.y / step) * step,
    };
    // If a change to the fixture's canvas ever lands the panned centre on a
    // line, this fails rather than passing for the wrong reason: move the pan.
    expect(
      Math.abs(centre.x - nearest.x) + Math.abs(centre.y - nearest.y),
    ).toBeGreaterThan(1);

    await page.getByTestId("place-game.crate").click();
    const placed = await draftAfter(
      request,
      token,
      { undoDepth: 1, redoDepth: 0 },
      secondLevel,
    );
    // The second way the "nearest line" assertion below stops holding:
    // `freeSpotNear` steps a new placement one whole cell aside when a drawn
    // one sits within half a step of it, which keeps it on the lattice but
    // carries it away from the middle. This template holds one placement, far
    // from the panned centre, so nothing steps aside. A template that grows a
    // second one fails here, naming the count, rather than in the arithmetic.
    expect(placed.document.entities).toHaveLength(2);
    const created = placed.document.entities.find(
      (entity) => entity.id !== MEADOW,
    );
    if (!created) throw new Error("the Actors strip created no placement.");
    const at = created.transform.position;
    // On a line, and on the line nearest the middle of the view.
    expect(at.x % step).toBeCloseTo(0, 9);
    expect(at.y % step).toBeCloseTo(0, 9);
    expect(Math.abs(at.x - centre.x)).toBeLessThanOrEqual(step / 2 + 1);
    expect(Math.abs(at.y - centre.y)).toBeLessThanOrEqual(step / 2 + 1);

    // An Actors click selects what it created, so the control bar is already
    // on it. A typed number is exact rather than landed on the lattice, which
    // is what the radians in the file say.
    const rotation = page.getByTestId("transform-rotation");
    await rotation.fill("45");
    await rotation.press("Enter");
    await draftAfter(
      request,
      token,
      { undoDepth: 2, redoDepth: 0 },
      secondLevel,
    );

    const name = page.getByTestId("placement-name");
    await name.fill("Lamp post");
    await name.press("Enter");
    await draftAfter(
      request,
      token,
      { undoDepth: 3, redoDepth: 0 },
      secondLevel,
    );
    await expect(page.getByTestId(`hierarchy-row-${created.id}`)).toContainText(
      "Lamp post",
    );

    await page.getByTestId("field-sprite-browse").click();
    await page.getByRole("option", { name: PICKED_SPRITE }).click();
    await expect(page.getByTestId("field-sprite")).toHaveValue(PICKED_SPRITE);
    await draftAfter(
      request,
      token,
      { undoDepth: 4, redoDepth: 0 },
      secondLevel,
    );

    await page.getByTestId("save-level").click();
    await expect(page.getByTestId("dirty-marker")).toBeHidden();

    // Written into the level the picker chose. The level the page opened on is
    // untouched, which is the other half of what a switch has to guarantee.
    const saved = savedPlacement(created.id, secondLevel);
    expectPoint(saved.transform.position, at);
    expect(saved.name).toBe("Lamp post");
    expect(saved.params["sprite"]).toBe(PICKED_SPRITE);
    expect(savedTransform(created.id, secondLevel).rotation).toBeCloseTo(
      Math.PI / 4,
      10,
    );
    expect(savedPlacements()).toHaveLength(3);

    const game = await context.newPage();
    await game.goto(`/game.html?file=/${secondLevel}`);
    await waitForInspector(game);
    const fact = await placementIn(game, created.id);
    expectPoint(fact.world, at);
    expect(fact.rotation).toBeCloseTo(Math.PI / 4, 6);
    expect(fact.sprite).toBe(PICKED_SPRITE);

    await expect(page.getByTestId("diagnostics")).toBeHidden();
  });

  test("shows a type's art before it is placed", async ({ page }) => {
    // The thumbnail is an address the browser asks the dev server for, so this
    // is the check that the authored default reaches the page as a picture
    // rather than as a broken image. The unit tests own which parameter is
    // picked.
    await openEditor(page);
    await openActors(page);

    const crate = page.getByTestId("thumb-game.crate");
    await expect(crate).toHaveAttribute("src", "assets/player_idle.png");
    await expect
      .poll(async () =>
        crate.evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBeGreaterThan(0);
    // No declared grid and no atlas beside it: the whole picture, fitted.
    await expect(crate).not.toHaveClass(/ye-actors__thumb-img--framed/);
  });

  test("crops a sheet to the frame its type declares", async ({ page }) => {
    // The whole contract on one path: the torch states its frame width once,
    // the parameter carries it to the browser, and the panel shows that frame
    // instead of a 384-pixel strip drawn 24 pixels wide.
    await openEditor(page);
    await openActors(page);

    const torch = page.getByTestId("thumb-game.torch");
    await expect(torch).toHaveAttribute("src", "assets/player_walk.png");
    await expect
      .poll(async () =>
        torch.evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBeGreaterThan(0);
    // One 48-pixel frame of a 384-pixel sheet, filling the 24-pixel box.
    await expect(torch).toHaveCSS("width", "192px");
    await expect(torch).toHaveCSS("left", "0px");
  });

  test("lands a drag on the grid, in one undo step", async ({
    page,
    request,
  }) => {
    // The lattice reaches the file only through the whole path: the toolbar
    // setting, the pose the drag computes, the command, and the write. The
    // unit tests own the arithmetic; this owns the claim that the number in
    // the file is on the grid.
    await openEditor(page);
    const token = await tokenOf(page);
    const start = savedPlacement(ROOT).transform.position;
    const step = await gridStep(page);

    // Chosen to leave the pointer clear of a half-cell on both axes: landing
    // exactly between two lattice points makes the assertion below a test of
    // which way a tie breaks rather than of where the drag ended.
    const drag = { x: 130, y: 80 };
    const free = offset(start, await expectedWorldDelta(page, drag));
    await dragPlacement(page, ROOT, drag);
    // One drag is one entry, snapped or not.
    await draftAfter(request, token, { undoDepth: 1, redoDepth: 0 });

    await page.getByTestId("save-level").click();
    await expect(page.getByTestId("dirty-marker")).toBeHidden();

    const saved = savedPlacement(ROOT).transform.position;
    expect(saved.x % step).toBeCloseTo(0, 9);
    expect(saved.y % step).toBeCloseTo(0, 9);
    // The nearest lattice point to where the pointer left it, rather than the
    // start moved by a whole number of cells.
    expect(saved).toEqual({
      x: Math.round(free.x / step) * step,
      y: Math.round(free.y / step) * step,
    });
  });

  test("lets a drag off the grid while Alt is held", async ({ page }) => {
    // The only case that proves the modifier survives the built bundle: it is
    // read off each pointer move in the browser and never crosses the wire.
    await openEditor(page);
    const start = savedPlacement(ROOT).transform.position;
    const step = await gridStep(page);

    const drag = { x: 120, y: 80 };
    const free = offset(start, await expectedWorldDelta(page, drag));
    const facts = await placementsIn(page);
    const fact = facts.find((one) => one.sceneId === ROOT);
    if (!fact) throw new Error(`the preview has no placement ${ROOT}`);
    const from = await clientPointOf(page, fact.world);

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + drag.x / 2, from.y + drag.y / 2);
    await page.keyboard.down("Alt");
    await page.mouse.move(from.x + drag.x, from.y + drag.y);
    await page.mouse.up();
    await page.keyboard.up("Alt");

    await page.getByTestId("save-level").click();
    await expect(page.getByTestId("dirty-marker")).toBeHidden();

    const saved = savedPlacement(ROOT).transform.position;
    expectPoint(saved, free);
    expect(saved.x % step === 0 && saved.y % step === 0).toBe(false);
  });

  test("duplicates a parented placement, keeping its shape in the file", async ({
    page,
  }) => {
    // The composition no unit test reaches: the shortcut narrows the selection
    // to its roots, the clone rewrites ids and the links between them, and the
    // whole thing has to survive the command round trip and reach the file
    // still shaped like what was copied. A clone that kept a source id, or
    // pointed a copied child back at the original parent, is a level that has
    // silently lost its structure.
    await openEditor(page);
    await page.getByTestId(`hierarchy-row-${ROOT}`).click();
    await page.keyboard.press("ControlOrMeta+d");
    await expect(page.getByTestId("dirty-marker")).toBeVisible();

    await page.getByTestId("save-level").click();
    await expect(page.getByTestId("dirty-marker")).toBeHidden();

    const saved = savedPlacements();
    // Two originals plus the two copies of the parented pair, and nothing else.
    expect(saved).toHaveLength(authoredLines().length + 2);

    const copies = saved.filter(
      (placement) => placement.id !== ROOT && placement.id !== CHILD,
    );
    const copiedRoot = copies.find(
      (placement) => placement.parent === undefined,
    );
    const copiedChild = copies.find(
      (placement) => placement.parent !== undefined,
    );
    expect(copiedRoot).toBeDefined();
    expect(copiedChild).toBeDefined();
    // The copied child hangs off the copied root, not off the original.
    expect(copiedChild?.parent).toBe(copiedRoot?.id);
    expect(copiedChild?.parent).not.toBe(ROOT);
    // The originals are untouched, including the link between them.
    expect(savedPlacement(CHILD).parent).toBe(ROOT);
  });

  test("takes a duplicate back in one undo", async ({ page }) => {
    await openEditor(page);
    await page.getByTestId(`hierarchy-row-${ROOT}`).click();
    await page.keyboard.press("ControlOrMeta+d");
    await expect(page.getByTestId("dirty-marker")).toBeVisible();
    // The marker appears from the browser's own optimistic state, before the
    // server has answered. Undo reads the server's history, so it does nothing
    // until the answer lands — the same condition the Undo button shows.
    await expect(page.getByTestId("undo")).toBeEnabled();

    const duplicated = await placementsIn(page);

    await page.keyboard.press("ControlOrMeta+z");

    // One command, so one undo takes back both copies rather than one of them,
    // and the draft matches the file again with nothing left to save.
    await expect(page.getByTestId("dirty-marker")).toBeHidden();
    await expectPlacements(page, authoredLines());
    expect(duplicated).toHaveLength(authoredLines().length + 2);
    await expect(page.getByTestId("save-level")).toBeDisabled();
  });

  test("scales a placement from its box, outward from the near side", async ({
    page,
  }) => {
    // The composition the unit tests cannot reach: the box tool decides which
    // transform a press performs from the region it lands in, and the handle's
    // own side decides which way a drag grows the placement. A handle on the
    // box's near side is the case that runs backwards when its side is applied
    // twice, and it reaches the file as a scale in the wrong direction.
    await openEditor(page);
    await page.getByTestId("tool-box").click();
    await page.getByTestId(`hierarchy-row-${ROOT}`).click();

    const centre = await clientPointOf(page, authored(ROOT));
    const viewport = page.getByTestId("yage-editor-viewport");
    const cursorAt = async (x: number): Promise<string> => {
      await page.mouse.move(x, centre.y);
      return viewport.evaluate((element) => element.style.cursor);
    };

    // Out along the negative x axis: the interior reads as a move, and the
    // first resize cursor is the near side's handle coming into reach. It
    // reads `ew-resize` because that handle grows the placement along x, which
    // is the whole chain from the box's geometry to the pointer.
    let handle = 0;
    for (let away = 4; away < 400; away += 1) {
      if ((await cursorAt(centre.x - away)) === "ew-resize") {
        handle = away;
        break;
      }
    }
    expect(handle).toBeGreaterThan(0);

    const grabAt = centre.x - handle - 1;
    await page.mouse.move(grabAt, centre.y);
    await page.mouse.down();
    await page.keyboard.down("Shift");
    await page.mouse.move(grabAt - 40, centre.y, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up("Shift");

    await expect(page.getByTestId("dirty-marker")).toBeVisible();
    await page.getByTestId("save-level").click();
    await expect(page.getByTestId("dirty-marker")).toBeHidden();

    const saved = savedTransform(ROOT);
    // Dragging the near side away from the pivot makes the placement bigger,
    // and the modifier keeps the two axes together.
    expect(saved.scale.x).toBeGreaterThan(1.05);
    expect(saved.scale.y).toBeCloseTo(saved.scale.x, 6);
    // A scale pivots on the placement's own origin and leaves it alone.
    expectPoint(saved.position, authored(ROOT));
  });

  test("brings a placement authored at no size back from its box", async ({
    page,
    context,
  }) => {
    // Both halves of what this level format now allows: a scale of zero
    // survives the round trip to a game page, and a drag can leave it. A box
    // handle divides by the side's own offset at a scale of one, which is a
    // property of the artwork, so it has something to divide by however small
    // the placement is drawn.
    useTemplate(FLAT_TEMPLATE);

    const game = await context.newPage();
    await game.goto(`/game.html?file=/${level}`);
    await waitForInspector(game);
    expect((await placementIn(game, FLAT)).scale).toEqual({ x: 0, y: 0 });

    await openEditorPage(page);
    await page.getByTestId("tool-box").click();
    await page.getByTestId(`hierarchy-row-${FLAT}`).click();

    // The placement draws nothing, so the box round it is the smallest one
    // the editor will draw and the corner grip is found rather than assumed.
    const centre = await clientPointOf(page, FLAT_POSITION);
    const viewport = page.getByTestId("yage-editor-viewport");
    let corner = 0;
    for (let away = 4; away < 200; away += 1) {
      await page.mouse.move(centre.x + away, centre.y + away);
      const cursor = await viewport.evaluate((element) => element.style.cursor);
      if (cursor === "nwse-resize") {
        corner = away;
        break;
      }
    }
    expect(corner).toBeGreaterThan(0);

    await page.mouse.move(centre.x + corner, centre.y + corner);
    await page.mouse.down();
    await page.mouse.move(centre.x + corner + 60, centre.y + corner + 60, {
      steps: 6,
    });
    await page.mouse.up();

    const grown = await placementIn(page, FLAT);
    expect(grown.scale.x).toBeGreaterThan(0);
    expect(grown.scale.y).toBeGreaterThan(0);

    await expect(page.getByTestId("dirty-marker")).toBeVisible();
    await page.getByTestId("save-level").click();
    await expect(page.getByTestId("dirty-marker")).toBeHidden();

    const saved = savedTransform(FLAT);
    expect(saved.scale.x).toBeCloseTo(grown.scale.x, 6);
    expect(saved.scale.y).toBeCloseTo(grown.scale.y, 6);
    // A scale turns about the placement's own origin and leaves it alone.
    expectPoint(saved.position, FLAT_POSITION);

    await game.reload();
    await waitForInspector(game);
    const loaded = await placementIn(game, FLAT);
    expect(loaded.scale.x).toBeCloseTo(grown.scale.x, 6);
    expect(loaded.scale.y).toBeCloseTo(grown.scale.y, 6);
  });

  test("turns a placement from the band outside its box", async ({ page }) => {
    await openEditor(page);
    await page.getByTestId("tool-box").click();
    await page.getByTestId(`hierarchy-row-${ROOT}`).click();

    const centre = await clientPointOf(page, authored(ROOT));
    const viewport = page.getByTestId("yage-editor-viewport");
    // Past the handles, in the band: the last place a press still means the
    // gizmo rather than the empty space behind it. The band is the only region
    // that draws nothing, so the curved-arrow cursor is what marks it — and
    // what tells it apart from the handle just inside, which resizes.
    let band = 0;
    for (let away = 4; away < 400; away += 1) {
      await page.mouse.move(centre.x, centre.y - away);
      const cursor = await viewport.evaluate((element) => element.style.cursor);
      if (cursor.startsWith("url(")) band = away;
      if (cursor === "grab" && band > 0) break;
    }
    expect(band).toBeGreaterThan(0);

    await page.mouse.move(centre.x, centre.y - band);
    await page.mouse.down();
    await page.mouse.move(centre.x + band, centre.y, { steps: 6 });
    await page.mouse.up();

    await expect(page.getByTestId("dirty-marker")).toBeVisible();
    await page.getByTestId("save-level").click();
    await expect(page.getByTestId("dirty-marker")).toBeHidden();

    const saved = savedTransform(ROOT);
    // A quarter turn round the pivot, and nothing else.
    expect(saved.rotation).toBeCloseTo(Math.PI / 2, 2);
    expect(saved.scale).toEqual({ x: 1, y: 1 });
    expectPoint(saved.position, authored(ROOT));
  });

  test("steps a turn to a fixed angle while the modifier is held", async ({
    page,
  }) => {
    // The step belongs to the modifier and not to Snap, so the case switches
    // the lattice off: a developer who wants a fixed angle asks for it once by
    // holding a key, rather than by leaving a mode on.
    await openEditor(page);
    await withoutSnapping(page);
    await page.getByTestId(`hierarchy-row-${ROOT}`).click();
    await page.getByTestId("tool-rotate").click();

    const anchor = await clientPointOf(page, authored(ROOT));
    const ring = await ringRadius(page, anchor);
    // Forty degrees round, which is nearest the third step at forty-five.
    const round = (40 * Math.PI) / 180;
    await page.mouse.move(anchor.x + ring, anchor.y);
    await page.mouse.down();
    await page.keyboard.down("Shift");
    await page.mouse.move(
      anchor.x + Math.cos(round) * ring,
      anchor.y + Math.sin(round) * ring,
      { steps: 6 },
    );
    await page.mouse.up();
    await page.keyboard.up("Shift");

    await expect(page.getByTestId("dirty-marker")).toBeVisible();
    await page.getByTestId("save-level").click();
    await expect(page.getByTestId("dirty-marker")).toBeHidden();

    expect(savedTransform(ROOT).rotation).toBeCloseTo(Math.PI / 4, 6);
  });

  test("turns a multi-selection about the placement it anchors on", async ({
    page,
  }) => {
    // The composition no unit test reaches: the gizmo has to draw over two
    // placements, the pivot has to reach the gesture, and the pose has to go
    // out through world space and back before it lands in the file.
    await openEditor(page);
    await page.getByTestId(`hierarchy-row-${ROOT}`).click();
    await page
      .getByTestId(`hierarchy-row-${LATER}`)
      .click({ modifiers: ["ControlOrMeta"] });
    await page.getByTestId("tool-rotate").click();

    // The default pivot anchors on the last one selected, so the ring is
    // centred on it and its world position is known.
    const anchor = await clientPointOf(page, authored(LATER));
    const ring = await ringRadius(page, anchor);

    await page.mouse.move(anchor.x + ring, anchor.y);
    await page.mouse.down();
    await page.mouse.move(anchor.x, anchor.y + ring, { steps: 8 });
    await page.mouse.up();

    await expect(page.getByTestId("dirty-marker")).toBeVisible();
    await page.getByTestId("save-level").click();
    await expect(page.getByTestId("dirty-marker")).toBeHidden();

    // The one the gizmo anchors on turns where it stands.
    const later = savedTransform(LATER);
    expect(later.rotation).toBeCloseTo(Math.PI / 2, 2);
    expectPoint(later.position, authored(LATER));

    // The other orbits it, a quarter turn about (250, 150), and turns by the
    // same angle — so the two keep the arrangement they had.
    const root = savedTransform(ROOT);
    expect(root.rotation).toBeCloseTo(Math.PI / 2, 2);
    expect(root.position.x).toBeCloseTo(550, 0);
    expect(root.position.y).toBeCloseTo(-300, 0);

    // The child travelled with its parent, so its own authored transform is
    // untouched — relative to a parent that turned, which is what carries it
    // round. Writing it as well would have turned it twice.
    const child = savedTransform(CHILD);
    expectPoint(child.position, { x: 100, y: 150 });
    expect(child.rotation).toBe(0);
  });

  test("keeps the scale arms on the placement's own axes under world", async ({
    page,
  }) => {
    // A scale can only grow a placement along its own axes, so an arm drawn
    // along the level's would point where the placement will not grow. The
    // axes toggle is Move's, and the toolbar says so.
    await openEditor(page);
    await page.getByTestId(`hierarchy-row-${ROOT}`).click();
    // While Move is the tool the choice is live, which is the only place it
    // is: every other tool disables it below.
    await page.getByTestId("axes-world").click();
    await page.getByTestId("tool-box").click();

    const centre = await clientPointOf(page, authored(ROOT));
    const band = await turnBandRadius(page, centre);
    await page.mouse.move(centre.x, centre.y - band);
    await page.mouse.down();
    await page.mouse.move(centre.x + band, centre.y, { steps: 6 });
    await page.mouse.up();
    await expect
      .poll(async () => (await placementIn(page, ROOT)).rotation)
      .toBeCloseTo(Math.PI / 2, 2);

    await page.getByTestId("tool-scale").click();
    await expect(page.getByTestId("axes-world")).toBeDisabled();
    await expect(page.getByTestId("axes-world")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // A quarter turn puts the placement's x axis along the level's y, so the
    // arm that grows `scale.x` runs down the screen and nothing resizes along
    // the horizontal.
    await expect
      .poll(async () => await armCursorAlong(page, centre, { x: 1, y: 0 }))
      .not.toBe("ew-resize");
    expect(await armCursorAlong(page, centre, { x: 0, y: 1 })).toBe(
      "ns-resize",
    );
  });

  test("takes a gizmo turn back, and puts it forward again", async ({
    page,
    request,
  }) => {
    // A gizmo drag passes through the pointer, a live pose draft, and a
    // settle before it becomes a command. Nothing so far checks that the trip
    // produces one history entry rather than one per pointer move, or that
    // the entry inverts to the pose the placement started at.
    await openEditor(page);
    const token = await tokenOf(page);
    await page.getByTestId(`hierarchy-row-${ROOT}`).click();
    await page.getByTestId("tool-rotate").click();

    const anchor = await clientPointOf(page, authored(ROOT));
    const ring = await ringRadius(page, anchor);
    await page.mouse.move(anchor.x + ring, anchor.y);
    await page.mouse.down();
    await page.mouse.move(anchor.x, anchor.y + ring, { steps: 8 });
    await page.mouse.up();

    // One drag, one entry — asserted before the pose, because a drag that
    // wrote one command per pointer move would also arrive at the right angle.
    await draftAfter(request, token, { undoDepth: 1, redoDepth: 0 });
    expect((await placementIn(page, ROOT)).rotation).toBeCloseTo(
      Math.PI / 2,
      2,
    );

    await page.getByTestId("undo").click();
    await draftAfter(request, token, { undoDepth: 0, redoDepth: 1 });
    await expect
      .poll(async () => (await placementIn(page, ROOT)).rotation)
      .toBeCloseTo(0, 2);
    // The turn is off the placement, and it never reached the file.
    await expect(page.getByTestId("dirty-marker")).toBeHidden();

    await page.getByTestId("redo").click();
    await draftAfter(request, token, { undoDepth: 1, redoDepth: 0 });
    await expect
      .poll(async () => (await placementIn(page, ROOT)).rotation)
      .toBeCloseTo(Math.PI / 2, 2);
  });

  test("scales the same however far along the arm it is grabbed, and the game page loads the result", async ({
    page,
    context,
  }) => {
    // A scale measures the drag against the arm's whole length, and the whole
    // arm grabs. So the same drag has to give the same factor from either end
    // of it — the defect this guards is a factor taken from the press point,
    // which agrees with the correct one only at the tip.
    await openEditor(page);
    await page.getByTestId(`hierarchy-row-${ROOT}`).click();
    await page.getByTestId("tool-scale").click();

    // The arms lie along the placement's own axes, so this one runs along
    // world x while the placement is upright. The turn comes after the
    // stretch for that reason: a ring is the same in every direction, an arm
    // is not.
    const anchor = await clientPointOf(page, authored(ROOT));
    const reach = await scaleArmReach(page, anchor);
    const far = Math.round((reach.nearest + reach.farthest) / 2);
    // Far enough apart that a factor read off the press point could not land
    // within the tolerance below by accident.
    expect(far - reach.nearest).toBeGreaterThan(20);

    const pull = 40;
    const stretch = async (from: number): Promise<number> => {
      await page.mouse.move(anchor.x + from, anchor.y);
      await page.mouse.down();
      await page.mouse.move(anchor.x + from + pull, anchor.y, { steps: 4 });
      await page.mouse.up();
      await expect
        .poll(async () => (await placementIn(page, ROOT)).scale.x)
        .toBeGreaterThan(1.05);
      return (await placementIn(page, ROOT)).scale.x;
    };

    const fromTheInnerEnd = await stretch(reach.nearest);
    await page.getByTestId("undo").click();
    await expect
      .poll(async () => (await placementIn(page, ROOT)).scale.x)
      .toBeCloseTo(1, 6);

    const fromTheOuterEnd = await stretch(far);
    expect(fromTheOuterEnd).toBeCloseTo(fromTheInnerEnd, 6);
    // The other axis is the arm's own, and it is the only one that moved.
    expect((await placementIn(page, ROOT)).scale.y).toBeCloseTo(1, 6);

    // Back and forward again, so the stretch is one entry in both directions
    // and the rest of the case runs on a redone pose rather than a fresh one.
    await page.getByTestId("undo").click();
    await expect
      .poll(async () => (await placementIn(page, ROOT)).scale.x)
      .toBeCloseTo(1, 6);
    await page.getByTestId("redo").click();
    await expect
      .poll(async () => (await placementIn(page, ROOT)).scale.x)
      .toBeCloseTo(fromTheOuterEnd, 6);

    await page.getByTestId("tool-rotate").click();
    const ring = await ringRadius(page, anchor);
    await page.mouse.move(anchor.x + ring, anchor.y);
    await page.mouse.down();
    await page.mouse.move(anchor.x, anchor.y + ring, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(async () => (await placementIn(page, ROOT)).rotation)
      .toBeCloseTo(Math.PI / 2, 2);

    await expect(page.getByTestId("dirty-marker")).toBeVisible();
    await page.getByTestId("save-level").click();
    await expect(page.getByTestId("dirty-marker")).toBeHidden();

    const saved = savedTransform(ROOT);
    expect(saved.rotation).toBeCloseTo(Math.PI / 2, 2);
    expect(saved.scale.x).toBeCloseTo(fromTheOuterEnd, 6);
    expect(saved.scale.y).toBeCloseTo(1, 6);
    // Neither gesture moved the placement: a turn and a stretch both pivot on
    // its own origin.
    expectPoint(saved.position, authored(ROOT));

    // The turn and the stretch reach a page that only reads the file, which
    // is the half neither the draft nor the preview can answer.
    const game = await context.newPage();
    await game.goto(`/game.html?file=/${level}`);
    await waitForInspector(game);
    const loaded = await placementIn(game, ROOT);
    expect(loaded.rotation).toBeCloseTo(Math.PI / 2, 2);
    expect(loaded.scale.x).toBeCloseTo(fromTheOuterEnd, 6);
    expect(loaded.scale.y).toBeCloseTo(1, 6);
  });

  test("drags a child of a turned and mirrored parent", async ({
    page,
    context,
    request,
  }) => {
    useTemplate(TURNED_TEMPLATE);
    await openEditorPage(page);
    await withoutSnapping(page);
    const token = await tokenOf(page);

    const root = await placementIn(page, ROOT);
    expect(root.rotation).toBeCloseTo(TURNED_ROTATION, 6);
    expect(root.scale.x).toBeCloseTo(-1, 6);
    const before = await placementIn(page, CHILD);

    const drag = { x: 90, y: -60 };
    const moved = await expectedWorldDelta(page, drag);
    await page.getByTestId("tool-box").click();
    await dragPlacement(page, CHILD, drag);

    // One drag, one entry, and the child ends up where the pointer left it —
    // in the world, not in the parent's reflected copy of it.
    await draftAfter(request, token, { undoDepth: 1, redoDepth: 0 });
    await expect
      .poll(async () => (await placementIn(page, CHILD)).world.x)
      .toBeCloseTo(before.world.x + moved.x, 0);
    expect((await placementIn(page, CHILD)).world.y).toBeCloseTo(
      before.world.y + moved.y,
      0,
    );

    // The parent kept its pose: a child's drag writes the child.
    const after = await placementIn(page, ROOT);
    expect(after.rotation).toBeCloseTo(TURNED_ROTATION, 6);
    expect(after.scale.x).toBeCloseTo(-1, 6);

    // The drag wrote the child's own transform, in the parent's space, and a
    // page that only reads the file puts it back where the pointer left it.
    // Stored reflected it would round-trip to the mirror of that.
    await page.getByTestId("save-level").click();
    await expect(page.getByTestId("dirty-marker")).toBeHidden();
    const saved = savedTransform(CHILD);
    expect(saved.rotation).toBe(0);
    expect(saved.scale).toEqual({ x: 1, y: 1 });

    const game = await context.newPage();
    await game.goto(`/game.html?file=/${level}`);
    await waitForInspector(game);
    expectPoint((await placementIn(game, CHILD)).world, {
      x: before.world.x + moved.x,
      y: before.world.y + moved.y,
    });
  });

  test("pans and zooms the view without touching the level", async ({
    page,
  }) => {
    await openEditor(page);
    await withoutSnapping(page);
    const authoredHere = await clientPointOf(page, authored(ROOT));

    // The middle button pans from anywhere, including from on top of a
    // placement, and moves nothing but the camera.
    const by = { x: -200, y: -120 };
    await page.mouse.move(authoredHere.x, authoredHere.y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(authoredHere.x + by.x / 2, authoredHere.y + by.y / 2);
    await page.mouse.move(authoredHere.x + by.x, authoredHere.y + by.y);
    await page.mouse.up({ button: "middle" });

    const panned = await expectedWorldDelta(page, { x: -by.x, y: -by.y });
    expectPoint((await editorCamera(page)).position, panned);
    await expect(page.getByTestId("dirty-marker")).toBeHidden();
    await expectPlacements(page, authoredLines());

    // Zoom around a point and it stays where it is on the page, which is what
    // says the anchor maths reached the camera rather than a bare zoom.
    const before = await clientPointOf(page, authored(LATER));
    await page.mouse.move(before.x, before.y);
    await page.mouse.wheel(0, -240);
    await expect
      .poll(async () => (await editorCamera(page)).zoom > 1)
      .toBe(true);
    expectPoint(await clientPointOf(page, authored(LATER)), before);

    // And the moved view still puts a press where the placement is drawn: the
    // drag lands on the crate rather than panning past it, and it covers the
    // world distance the zoom says those pixels are worth.
    const drag = { x: 40, y: 30 };
    const expected = offset(
      authored(LATER),
      await expectedWorldDelta(page, drag),
    );
    await dragPlacement(page, LATER, drag);
    await expectPlacements(page, [
      factLine(ROOT, authored(ROOT)),
      factLine(CHILD, authored(CHILD), { parent: ROOT }),
      factLine(LATER, expected),
    ]);
  });

  test("pans with space held, from on top of a placement", async ({ page }) => {
    await openEditor(page);
    const from = await clientPointOf(page, authored(ROOT));

    // What a trackpad has instead of a middle button. The press lands on a
    // placement and still pans, and the placement stays where it is.
    await page.keyboard.down(" ");
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x - 80, from.y - 40);
    await page.mouse.up();
    await page.keyboard.up(" ");

    const panned = await expectedWorldDelta(page, { x: 80, y: 40 });
    expectPoint((await editorCamera(page)).position, panned);
    await expectPlacements(page, authoredLines());
    await expect(page.getByTestId("dirty-marker")).toBeHidden();
  });

  test("remembers the view across a reload", async ({ page }) => {
    await openEditor(page);
    const from = await clientPointOf(page, authored(ROOT));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(from.x - 120, from.y - 60);
    await page.mouse.up({ button: "middle" });
    const moved = (await editorCamera(page)).position;
    // Without this the restore would be compared against the origin, which is
    // also where a camera that never moved sits.
    expect(Math.hypot(moved.x, moved.y)).toBeGreaterThan(50);

    await page.reload();
    await waitForInspector(page);
    await expectPlacements(page, authoredLines());

    // The view is browser-local, so it comes back from the page's own storage
    // rather than from the draft the server kept.
    expectPoint((await editorCamera(page)).position, moved);
  });

  test("frames the selection, and puts the view back", async ({ page }) => {
    await openEditor(page);
    // The camera carries the fit's scale, so the zoom a reset returns to is
    // the one the editor booted with rather than 1.
    const booted = (await editorCamera(page)).zoom;
    // Pan first, so "framed" cannot be read off a camera that never moved:
    // the default view is the origin, which is also where a framing that did
    // nothing would leave it.
    await page.mouse.move(400, 300);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(300, 240);
    await page.mouse.up({ button: "middle" });
    expect((await editorCamera(page)).position).not.toEqual({ x: 0, y: 0 });

    await page.getByTestId(`hierarchy-row-${LATER}`).click();
    await page.keyboard.press("f");

    // The camera sits on what was selected and close enough to fill the view,
    // which is the whole point of framing a placement drawn a few tens of
    // pixels across in a level hundreds of units wide.
    await expect
      .poll(async () => (await editorCamera(page)).zoom)
      .toBeGreaterThan(1);
    expectPoint((await editorCamera(page)).position, authored(LATER));

    await page.keyboard.press("Shift+F");
    await expect.poll(async () => (await editorCamera(page)).zoom).toBe(booted);
    expectPoint((await editorCamera(page)).position, { x: 0, y: 0 });

    // The view is not the document: neither the framing nor the reset is an
    // edit, so there is nothing to save.
    await expect(page.getByTestId("dirty-marker")).toBeHidden();
    await expectPlacements(page, authoredLines());
  });

  test("holds the picture still when a panel opens under it", async ({
    page,
  }) => {
    await openEditor(page);
    const drawnAt = await clientPointOf(page, authored(ROOT));
    const hierarchy = await panelHeight(page, "hierarchy");
    const tall = await canvasHeight(page);

    // A strip the developer opened deliberately.
    await openActors(page);
    expect(await canvasHeight(page)).toBeLessThan(tall);
    expectPoint(await clientPointOf(page, authored(ROOT)), drawnAt);

    // And a finding, which arrives on its own schedule: a switch placed with
    // nothing chosen for the crate its required reference wants.
    const shorter = await canvasHeight(page);
    await page.getByTestId("place-game.switch").click();
    await expect(page.getByTestId("diagnostics")).toContainText(
      "has none chosen",
    );
    await expect.poll(() => canvasHeight(page)).toBeLessThan(shorter);

    expectPoint(await clientPointOf(page, authored(ROOT)), drawnAt);
    // The band takes its height from the viewport's own column, so the panels
    // beside it are exactly as tall as they were.
    expect(await panelHeight(page, "hierarchy")).toBe(hierarchy);
  });

  test("leaves the keyboard to a field being typed into", async ({ page }) => {
    await openEditor(page);
    await page.getByTestId(`hierarchy-row-${CHILD}`).click();
    await page.getByTestId("tool-box").click();
    const before = await editorCamera(page);

    // Every one of these is a shortcut on the window: `r` and `t` pick a tool,
    // `f` frames, `g` toggles the guides. Typed into an asset path they are
    // four letters.
    const field = page.getByTestId("field-sprite");
    await field.click();
    // A click puts the caret where it landed, so the four letters below would
    // otherwise arrive in the middle of the path. The panel overflows and its
    // scrollbar narrows this box, so a centre click lands at character 8 of a
    // 24-character path rather than past its end. The caret is set directly
    // because End does not move it in a text input on macOS.
    await field.evaluate((element: HTMLInputElement) => {
      element.setSelectionRange(element.value.length, element.value.length);
    });
    await field.press("r");
    await field.press("t");
    await field.press("f");
    await field.press("g");

    await expect(field).toHaveValue(`${spriteOf(CHILD)}rtfg`);
    await expect(page.getByTestId("tool-box")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await editorCamera(page)).toEqual(before);

    // Escape puts the field back without committing, so the level is as it
    // was and the keystrokes reached nothing else. Typing opened the
    // completion list, so the first press puts the list away and the second
    // puts the text back.
    await field.press("Escape");
    await field.press("Escape");
    await expect(field).toHaveValue(spriteOf(CHILD));
    await expect(page.getByTestId("dirty-marker")).toBeHidden();
  });

  test("picks a sprite from the project's assets", async ({
    page,
    context,
    request,
  }) => {
    await openEditor(page);
    const token = await tokenOf(page);
    await page.getByTestId(`hierarchy-row-${CHILD}`).click();

    // One press of the toggle, one click on a row. What makes this the real
    // test of the picker is the browser's own focus handling: a row that let
    // the box blur would commit the filter text as well, and the draft below
    // would be two edits deep.
    await page.getByTestId("field-sprite-browse").click();
    await page.getByRole("option", { name: PICKED_SPRITE }).click();

    await expect(page.getByTestId("field-sprite")).toHaveValue(PICKED_SPRITE);
    await draftAfter(request, token, { undoDepth: 1, redoDepth: 0 });
    await expectPlacements(page, [
      factLine(ROOT, authored(ROOT)),
      factLine(CHILD, authored(CHILD), {
        parent: ROOT,
        sprite: PICKED_SPRITE,
      }),
      factLine(LATER, authored(LATER)),
    ]);

    await page.getByTestId("save-level").click();
    await expect(page.getByTestId("dirty-marker")).toBeHidden();
    expect(savedPlacement(CHILD).params["sprite"]).toBe(PICKED_SPRITE);

    const game = await context.newPage();
    await game.goto(`/game.html?file=/${level}`);
    await waitForInspector(game);
    expect((await placementIn(game, CHILD)).sprite).toBe(PICKED_SPRITE);
  });

  test("offers a sprite added while the editor is running", async ({
    page,
  }) => {
    // The listing is re-read every time the list opens, which is the whole of
    // how a file added mid-session becomes offerable: there is no watcher, no
    // event stream, and no broadcast.
    //
    // A run killed by a timeout never reaches its `finally`, so the file goes
    // first: the baseline below then asserts something rather than reporting
    // what the previous run left in the fixture directory.
    rmSync(path.join(SPRITE_DIR, "added.png"), { force: true });
    await openEditor(page);
    await page.getByTestId(`hierarchy-row-${CHILD}`).click();

    const browse = page.getByTestId("field-sprite-browse");
    await browse.click();
    // A row the project already has, so the absence below cannot be an empty
    // list that the listing has not answered yet.
    await expect(
      page.getByRole("option", { name: PICKED_SPRITE }),
    ).toBeVisible();
    await expect(page.getByRole("option", { name: ADDED_SPRITE })).toHaveCount(
      0,
    );
    await browse.click();

    copyFileSync(
      path.join(SPRITE_DIR, "crate.png"),
      path.join(SPRITE_DIR, "added.png"),
    );
    try {
      await browse.click();
      await expect(
        page.getByRole("option", { name: ADDED_SPRITE }),
      ).toBeVisible();
    } finally {
      rmSync(path.join(SPRITE_DIR, "added.png"), { force: true });
    }
  });

  test("marks a placement that draws nothing, and selects it from the mark", async ({
    page,
    request,
  }) => {
    // A chime has a transform and one component with no picture, which is what
    // a light, an emitter or a diegetic panel is to the editor: the level draws
    // nothing there, so without the mark there is nothing on screen to press.
    await openEditor(page);
    const token = await tokenOf(page);

    await openActors(page);
    await page.getByTestId("place-game.chime").click();
    const placed = await draftAfter(request, token, {
      undoDepth: 1,
      redoDepth: 0,
    });
    const chime = placed.document.entities.find(
      (entity) => !AUTHORED[entity.id],
    );
    if (!chime) throw new Error("the Actors strip created no chime.");

    // Off it again, so the click on the mark is what selects it rather than
    // the click that created it.
    await page.getByTestId(`hierarchy-row-${ROOT}`).click();
    await expect(
      page.getByTestId(`hierarchy-item-${chime.id}`),
    ).toHaveAttribute("aria-selected", "false");

    // The chime's own point is empty: the mark sits a fixed distance above it,
    // in screen pixels, which is what the row is laid out in.
    const origin = await clientPointOf(page, chime.transform.position);
    await page.mouse.click(origin.x, origin.y - MARK_OFFSET);

    await expect(
      page.getByTestId(`hierarchy-item-${chime.id}`),
    ).toHaveAttribute("aria-selected", "true");
  });

  test("points a placement at another and loads the result", async ({
    page,
    context,
    request,
  }) => {
    // A switch declares a required reference to a crate and an optional one to
    // a chime. Nothing here types an id: the picker offers the level's crates,
    // and the game page reports which entity the handle resolved to.
    await openEditor(page);
    const token = await tokenOf(page);

    await openActors(page);
    await page.getByTestId("place-game.switch").click();
    const placed = await draftAfter(request, token, {
      undoDepth: 1,
      redoDepth: 0,
    });
    const created = placed.document.entities.find(
      (entity) => !(entity.id in AUTHORED),
    );
    if (!created) throw new Error("the Actors strip created no switch.");
    expect(created.params["door"]).toBeNull();

    // A required reference with nothing chosen is a problem the editor lists,
    // and the preview leaves the switch out until it is answered.
    await expect(page.getByTestId("diagnostics")).toContainText(
      "has none chosen",
    );

    const door = page.getByTestId("field-door");
    // Every crate in the level, by the name the template gave it, and neither
    // the chime nor the switch itself.
    await expect(door.locator("option")).toHaveText([
      "Choose a target",
      "Root",
      "Child",
      "Later",
    ]);
    await door.selectOption(ROOT);
    const pointed = await draftAfter(request, token, {
      undoDepth: 2,
      redoDepth: 0,
    });
    expect(
      pointed.document.entities.find((entity) => entity.id === created.id)
        ?.params["door"],
    ).toBe(ROOT);
    await expect(page.getByTestId("diagnostics")).toBeHidden();

    // The optional one stays unanswered, and Clear is the control that says
    // so — there is no empty row in the list to choose.
    await expect(page.getByTestId("clear-chime")).toBeDisabled();

    await page.getByTestId("save-level").click();
    await expect(page.getByTestId("dirty-marker")).toBeHidden();
    expect(savedPlacement(created.id).params["door"]).toBe(ROOT);

    const game = await context.newPage();
    await game.goto(`/game.html?file=/${level}`);
    await waitForInspector(game);
    // The whole point of the feature: `setup()` was handed a handle, and it
    // resolves to the crate the picker named.
    await expect
      .poll(async () => switchesIn(game))
      .toEqual([{ sceneId: created.id, door: ROOT, chime: null }]);
  });

  test("chooses a reference target by clicking it in the level", async ({
    page,
    request,
  }) => {
    await openEditor(page);
    const token = await tokenOf(page);

    await openActors(page);
    await page.getByTestId("place-game.switch").click();
    const placed = await draftAfter(request, token, {
      undoDepth: 1,
      redoDepth: 0,
    });
    const created = placed.document.entities.find(
      (entity) => !(entity.id in AUTHORED),
    );
    if (!created) throw new Error("the Actors strip created no switch.");

    await page.getByTestId("pick-door").click();
    await expect(page.getByTestId("field-door-picking")).toBeVisible();
    // The switch is not a crate, so it fades like everything else that is not
    // one; the three crates stay pickable.
    await expect(page.getByTestId(`hierarchy-row-${created.id}`)).toHaveClass(
      /is-unpickable/,
    );
    for (const id of [ROOT, CHILD, LATER]) {
      await expect(page.getByTestId(`hierarchy-row-${id}`)).not.toHaveClass(
        /is-unpickable/,
      );
    }

    const at = await clientPointOf(page, authored(LATER));
    await page.mouse.click(at.x, at.y);

    const pointed = await draftAfter(request, token, {
      undoDepth: 2,
      redoDepth: 0,
    });
    expect(
      pointed.document.entities.find((entity) => entity.id === created.id)
        ?.params["door"],
    ).toBe(LATER);
    await expect(page.getByTestId("field-door")).toHaveValue(LATER);
    // The press chose a target and did nothing else: the switch is still what
    // the inspector is showing, and nothing is waiting any more.
    await expect(page.getByTestId("field-door-picking")).toBeHidden();
    await expect(
      page.getByTestId(`hierarchy-item-${created.id}`),
    ).toHaveAttribute("aria-selected", "true");
  });

  test("gives up on picking, and picks from the hierarchy instead", async ({
    page,
    request,
  }) => {
    await openEditor(page);
    const token = await tokenOf(page);

    await openActors(page);
    await page.getByTestId("place-game.switch").click();
    const placed = await draftAfter(request, token, {
      undoDepth: 1,
      redoDepth: 0,
    });
    const created = placed.document.entities.find(
      (entity) => !(entity.id in AUTHORED),
    );
    if (!created) throw new Error("the Actors strip created no switch.");

    await page.getByTestId("pick-door").click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("field-door-picking")).toBeHidden();
    expect(
      (await draftOf(request, token)).document.entities.find(
        (entity) => entity.id === created.id,
      )?.params["door"],
    ).toBeNull();

    await page.getByTestId("pick-door").click();
    await page.getByTestId(`hierarchy-row-${ROOT}`).click();

    const pointed = await draftAfter(request, token, {
      undoDepth: 2,
      redoDepth: 0,
    });
    expect(
      pointed.document.entities.find((entity) => entity.id === created.id)
        ?.params["door"],
    ).toBe(ROOT);
    // The row chose a target; it did not move the selection to the crate.
    await expect(page.getByTestId(`hierarchy-item-${ROOT}`)).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  test("asks before deleting a placement something points at", async ({
    page,
    request,
  }) => {
    await openEditor(page);
    const token = await tokenOf(page);

    await openActors(page);
    await page.getByTestId("place-game.switch").click();
    const placed = await draftAfter(request, token, {
      undoDepth: 1,
      redoDepth: 0,
    });
    const created = placed.document.entities.find(
      (entity) => !(entity.id in AUTHORED),
    );
    if (!created) throw new Error("the Actors strip created no switch.");
    await page.getByTestId("field-door").selectOption(ROOT);
    await draftAfter(request, token, { undoDepth: 2, redoDepth: 0 });

    // Deleting the target is where the question belongs: the switch survives
    // and would be left pointing at nothing.
    await page.getByTestId(`hierarchy-row-${ROOT}`).click();
    await page.getByTestId("delete-selection").click();
    const dialog = page.getByTestId("delete-confirm");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("delete-confirm-referrers")).toContainText(
      "door",
    );

    await page.getByTestId("cancel-delete").click();
    await expect(dialog).toBeHidden();
    // Nothing was sent: the draft is still at the two edits above.
    expect(idsOf(await draftOf(request, token))).toEqual([
      ROOT,
      CHILD,
      LATER,
      created.id,
    ]);

    await page.getByTestId("delete-selection").click();
    await page.getByTestId("confirm-delete").click();
    const deleted = await draftAfter(request, token, {
      undoDepth: 3,
      redoDepth: 0,
    });
    // The root and its child are gone; the switch keeps the id it held, which
    // is what one undo puts back.
    expect(idsOf(deleted)).toEqual([LATER, created.id]);
    expect(
      deleted.document.entities.find((entity) => entity.id === created.id)
        ?.params["door"],
    ).toBe(ROOT);
    await expect(page.getByTestId("diagnostics")).toContainText(
      "is not in this level",
    );
  });

  test("builds a placement, deletes it, takes both edits back, and saves", async ({
    page,
    context,
    request,
  }) => {
    await openEditor(page);
    await withoutSnapping(page);
    const token = await tokenOf(page);
    expect(savedPlacements()).toHaveLength(3);

    // An Actors click puts the type in the middle of the view.
    await openActors(page);
    await page.getByTestId("place-game.crate").click();
    await expect(page.getByTestId("dirty-marker")).toBeVisible();
    const placed = await draftAfter(request, token, {
      undoDepth: 1,
      redoDepth: 0,
    });
    const created = placed.document.entities.find(
      (entity) => !(entity.id in AUTHORED),
    );
    if (!created) throw new Error("the Actors strip created no placement.");
    const from = created.transform.position;
    const createdLine = (world: Point): string =>
      factLine(created.id, world, { sprite: spriteOf(ROOT) });
    await expectPlacements(page, [...authoredLines(), createdLine(from)]);

    // The created placement is the newest, so it is the one this drag picks up
    // even though the child's sprite is drawn under the same point.
    const drag = { x: 90, y: -60 };
    const to = offset(from, await expectedWorldDelta(page, drag));
    await dragPlacement(page, created.id, drag);
    const dragged = await draftAfter(request, token, {
      undoDepth: 2,
      redoDepth: 0,
    });
    expectPoint(positionOf(dragged, created.id), to);
    expect(positionOf(dragged, ROOT)).toEqual(AUTHORED[ROOT]);

    // Delete is read from the viewport, which the drag left focused.
    await page.keyboard.press("Delete");
    const deleted = await draftAfter(request, token, {
      undoDepth: 3,
      redoDepth: 0,
    });
    expect(idsOf(deleted)).toEqual([ROOT, CHILD, LATER]);
    await expectPlacements(page, authoredLines());

    await page.getByTestId("undo").click();
    const restored = await draftAfter(request, token, {
      undoDepth: 2,
      redoDepth: 1,
    });
    expectPoint(positionOf(restored, created.id), to);
    await expectPlacements(page, [...authoredLines(), createdLine(to)]);

    // Taking back a drag moves what the viewport draws, not only what the
    // document stores. A history step rebuilds the preview whatever it
    // changed, so what this pins is that the rebuilt scene draws the pose the
    // document went back to.
    await page.getByTestId("undo").click();
    const rewound = await draftAfter(request, token, {
      undoDepth: 1,
      redoDepth: 2,
    });
    expectPoint(positionOf(rewound, created.id), from);
    await expectPlacements(page, [...authoredLines(), createdLine(from)]);

    await page.getByTestId("redo").click();
    const replayed = await draftAfter(request, token, {
      undoDepth: 2,
      redoDepth: 1,
    });
    expectPoint(positionOf(replayed, created.id), to);
    await expectPlacements(page, [...authoredLines(), createdLine(to)]);

    await page.getByTestId("save-level").click();
    await expect(page.getByTestId("dirty-marker")).toBeHidden();

    // The created placement is last, because an Actors click appends and the
    // restore put it back at the index it was removed from.
    const saved = savedPlacements();
    expect(saved.map((placement) => placement.id)).toEqual([
      ROOT,
      CHILD,
      LATER,
      created.id,
    ]);
    expectPoint(saved[3]?.transform.position, to);

    const game = await context.newPage();
    await game.goto(`/game.html?file=/${level}`);
    await waitForInspector(game);
    await expectPlacements(game, [...authoredLines(), createdLine(to)]);

    await expect(page.getByTestId("diagnostics")).toBeHidden();
  });

  test("edits a parameter, moves the placement, and loads the result", async ({
    page,
    context,
    request,
  }) => {
    await openEditor(page);
    const token = await tokenOf(page);

    // The child is selected from the hierarchy, not the viewport: its row is
    // what says which of three crates the inspector is showing.
    await page.getByTestId(`hierarchy-row-${CHILD}`).click();
    await expect(page.getByTestId("placement-name")).toHaveValue("Child");
    const field = page.getByTestId("field-sprite");
    await expect(field).toHaveValue(spriteOf(CHILD));

    // The child with the asset the edit gives it, under whichever parent the
    // step being asserted leaves it with. Its world pose never changes: every
    // move here preserves it, which is the contract this test exists for.
    const childLine = (parent?: string): string =>
      factLine(CHILD, authored(CHILD), {
        sprite: EDITED_SPRITE,
        ...(parent === undefined ? {} : { parent }),
      });
    const rootLine = factLine(ROOT, authored(ROOT));
    const laterLine = factLine(LATER, authored(LATER));
    // What the preview draws after each of the four edits, with the authored
    // document first. Undoing walks back down this list and redoing walks up
    // it, so both directions are compared against the same states.
    const states: readonly (readonly string[])[] = [
      authoredLines(),
      [rootLine, childLine(ROOT), laterLine],
      [rootLine, laterLine, childLine()],
      [childLine(), rootLine, laterLine],
      [rootLine, laterLine, childLine(LATER)],
    ];
    const state = (index: number): readonly string[] => {
      const drawn = states[index];
      if (!drawn) throw new Error(`there is no state ${String(index)}`);
      return drawn;
    };

    // 1. The parameter edit. The preview rebuilds with the new texture and the
    //    placement keeps its pose.
    await field.fill(EDITED_SPRITE);
    await field.press("Enter");
    const edited = await draftAfter(request, token, {
      undoDepth: 1,
      redoDepth: 0,
    });
    expect(placementOf(edited, CHILD).params).toEqual({
      sprite: EDITED_SPRITE,
    });
    await expectPlacements(page, state(1));

    // 2. Out of its parent. The stored transform becomes the world pose the
    //    child already had, so nothing moves on screen.
    await dragRowToRoot(page, CHILD);
    const unparented = await draftAfter(request, token, {
      undoDepth: 2,
      redoDepth: 0,
    });
    expect(placementOf(unparented, CHILD).parent).toBeUndefined();
    expect(idsOf(unparented)).toEqual([ROOT, LATER, CHILD]);
    expectPoint(positionOf(unparented, CHILD), authored(CHILD));
    await expectPlacements(page, state(2));

    // 3. Reordered above the root it used to belong to. A move that keeps the
    //    parent keeps the transform object as it is.
    await dragRowBefore(page, CHILD, ROOT);
    const reordered = await draftAfter(request, token, {
      undoDepth: 3,
      redoDepth: 0,
    });
    expect(idsOf(reordered)).toEqual([CHILD, ROOT, LATER]);
    expect(positionOf(reordered, CHILD)).toEqual(positionOf(unparented, CHILD));
    await expectPlacements(page, state(3));

    // 4. Under the later root. The pose is preserved again, this time by
    //    subtracting a parent the child never had before.
    await dragRowInto(page, CHILD, LATER);
    const reparented = await draftAfter(request, token, {
      undoDepth: 4,
      redoDepth: 0,
    });
    expect(placementOf(reparented, CHILD).parent).toBe(LATER);
    expect(idsOf(reparented)).toEqual([ROOT, LATER, CHILD]);
    expectPoint(positionOf(reparented, CHILD), { x: -350, y: -150 });
    await expectPlacements(page, state(4));

    // Every edit taken back, one step each, down to the authored document.
    for (let depth = 3; depth >= 0; depth -= 1) {
      await page.getByTestId("undo").click();
      await draftAfter(request, token, {
        undoDepth: depth,
        redoDepth: 4 - depth,
      });
      await expectPlacements(page, state(depth));
    }
    const rewound = await draftOf(request, token);
    expect(idsOf(rewound)).toEqual([ROOT, CHILD, LATER]);
    expect(placementOf(rewound, CHILD).parent).toBe(ROOT);
    expect(placementOf(rewound, CHILD).params).toEqual({
      sprite: spriteOf(CHILD),
    });

    // And put back, which is what says each inverse was exact.
    for (let depth = 1; depth <= 4; depth += 1) {
      await page.getByTestId("redo").click();
      await draftAfter(request, token, {
        undoDepth: depth,
        redoDepth: 4 - depth,
      });
      await expectPlacements(page, state(depth));
    }

    await page.getByTestId("save-level").click();
    await expect(page.getByTestId("dirty-marker")).toBeHidden();
    expect(savedPlacements().map((placement) => placement.id)).toEqual([
      ROOT,
      LATER,
      CHILD,
    ]);
    expect(savedPlacement(CHILD).parent).toBe(LATER);
    expect(savedPlacement(CHILD).params).toEqual({ sprite: EDITED_SPRITE });

    // The asset, the parent, the order, and the world pose, as a game loads
    // them from the file.
    const game = await context.newPage();
    await game.goto(`/game.html?file=/${level}`);
    await waitForInspector(game);
    await expectPlacements(game, state(4));

    await expect(page.getByTestId("diagnostics")).toBeHidden();
  });

  test("types a transform, renames a placement, and gives it a key", async ({
    page,
    context,
    request,
  }) => {
    await openEditor(page);
    const token = await tokenOf(page);
    const file = path.join(LEVELS, path.basename(level));

    await page.getByTestId(`hierarchy-row-${LATER}`).click();
    await expect(page.getByTestId("placement-name")).toHaveValue("Later");

    // A typed angle is degrees, and it is exact: the grid is on with a step
    // of 32 and nothing here lands on it.
    const rotation = page.getByTestId("transform-rotation");
    await expect(rotation).toHaveValue("0");
    await rotation.fill("45");
    await rotation.press("Enter");
    await draftAfter(request, token, { undoDepth: 1, redoDepth: 0 });

    await page.getByTestId("save-level").click();
    await expect(page.getByTestId("dirty-marker")).toBeHidden();
    expect(savedTransform(LATER).rotation).toBeCloseTo(Math.PI / 4, 10);
    // The bytes the rename and the key have to come back to.
    const turned = readFileSync(file, "utf8");

    const name = page.getByTestId("placement-name");
    await name.fill("Lamp post");
    await name.press("Enter");
    await draftAfter(request, token, { undoDepth: 2, redoDepth: 0 });
    await expect(page.getByTestId(`hierarchy-row-${LATER}`)).toContainText(
      "Lamp post",
    );

    const key = page.getByTestId("placement-key");
    await key.fill("lamp");
    await key.press("Enter");
    const typed = await draftAfter(request, token, {
      undoDepth: 3,
      redoDepth: 0,
    });
    expect(placementOf(typed, LATER).name).toBe("Lamp post");
    expect(placementOf(typed, LATER).key).toBe("lamp");

    await page.getByTestId("save-level").click();
    await expect(page.getByTestId("dirty-marker")).toBeHidden();
    expect(savedPlacement(LATER).name).toBe("Lamp post");
    expect(savedPlacement(LATER).key).toBe("lamp");

    // The game page finds the entity under the key the editor wrote, turned
    // by the angle that was typed in degrees.
    const game = await context.newPage();
    await game.goto(`/game.html?file=/${level}`);
    await waitForInspector(game);
    const fact = await placementIn(game, "lamp");
    expect(fact.rotation).toBeCloseTo(Math.PI / 4, 6);
    expect(fact.sprite).toBe(spriteOf(LATER));

    // Two undos take the key and the name back, and what is written then is
    // the file as it stood before either — which is the rename round trip.
    await page.getByTestId("undo").click();
    await page.getByTestId("undo").click();
    const rewound = await draftAfter(request, token, {
      undoDepth: 1,
      redoDepth: 2,
    });
    // Back to the name the template authored, and to no key at all.
    expect(placementOf(rewound, LATER).name).toBe("Later");
    expect(placementOf(rewound, LATER).key).toBeUndefined();

    await page.getByTestId("save-level").click();
    await expect(page.getByTestId("dirty-marker")).toBeHidden();
    expect(readFileSync(file, "utf8")).toBe(turned);

    await expect(page.getByTestId("diagnostics")).toBeHidden();
  });

  test("steps a transform number with the arrows, as one edit", async ({
    page,
    request,
  }) => {
    await openEditor(page);
    const token = await tokenOf(page);

    await page.getByTestId(`hierarchy-row-${LATER}`).click();
    const x = page.getByTestId("transform-x");
    const started = Number(await x.inputValue());

    // Three presses of Up, then one with Shift for a whole grid cell of 32.
    // No history entry yet: the placement moves in the viewport and the
    // document has not been written.
    await x.press("ArrowUp");
    await x.press("ArrowUp");
    await x.press("ArrowUp");
    await x.press("Shift+ArrowUp");
    await expect(x).toHaveValue(String(started + 35));
    await expect(page.getByTestId("dirty-marker")).toBeVisible();
    expect((await draftOf(request, token)).history).toEqual({
      undoDepth: 0,
      redoDepth: 0,
    });

    // Leaving the box turns the whole burst into one command and one undo
    // step, exactness intact: 35 is not a multiple of the lattice.
    await x.press("Enter");
    const stepped = await draftAfter(request, token, {
      undoDepth: 1,
      redoDepth: 0,
    });
    expect(positionOf(stepped, LATER).x).toBeCloseTo(started + 35, 10);

    await page.getByTestId("undo").click();
    const back = await draftAfter(request, token, {
      undoDepth: 0,
      redoDepth: 1,
    });
    expect(positionOf(back, LATER).x).toBeCloseTo(started, 10);

    await expect(page.getByTestId("diagnostics")).toBeHidden();
  });

  test("drags a transform label without taking the keyboard", async ({
    page,
  }) => {
    await openEditor(page);
    await page.getByTestId(`hierarchy-row-${LATER}`).click();
    const x = page.getByTestId("transform-x");
    const started = Number(await x.inputValue());

    // Eight steps of four pixels, and the release commits them.
    const label = page.getByTestId("transform-x-label");
    const box = await label.boundingBox();
    if (!box) throw new Error("The label is not on screen.");
    const middle = box.y + box.height / 2;
    await page.mouse.move(box.x + 8, middle);
    await page.mouse.down();
    await page.mouse.move(box.x + 20, middle);
    await page.mouse.move(box.x + 40, middle);
    await page.mouse.up();
    await expect(x).toHaveValue(String(started + 8));

    // The drag ends in a click inside the `<label>` the box sits in, which
    // would otherwise focus the box: every one-letter shortcut would then be
    // typed into the number instead of reaching the shell.
    await page.keyboard.press("e");
    await expect(page.getByTestId("tool-rotate")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(x).toHaveValue(String(started + 8));
  });

  test("offers the lossy reset only where the declaration can repair it", async ({
    page,
    request,
  }) => {
    useTemplate(STALE_TEMPLATE);
    await openEditor(page, []);
    const token = await tokenOf(page);
    // Neither placement loads: one was authored against a type version the
    // project does not have, and the other names a file that is not there.
    await expect(page.getByTestId("diagnostics")).toBeVisible();
    await expectPlacements(page, []);

    // A missing file is not something defaults can repair, so no reset is
    // offered for it.
    await page.getByTestId(`hierarchy-row-${MISSING}`).click();
    await expect(page.getByTestId("placement-diagnostics")).toContainText(
      "no-such-texture.png",
    );
    await expect(page.getByTestId("reset-placement")).toBeHidden();

    // The stale placement is repairable: the declaration still has the
    // defaults its parameters are missing.
    await page.getByTestId(`hierarchy-row-${STALE}`).click();
    await expect(page.getByTestId("placement-diagnostics")).toContainText(
      "type version",
    );
    await page.getByTestId("reset-placement").click();
    await expect(page.getByTestId("reset-placement-confirm")).toContainText(
      "will be discarded",
    );
    await page.getByTestId("confirm-reset-placement").click();

    // Both the parameters and the type version move, in one history entry.
    const repaired = await draftAfter(request, token, {
      undoDepth: 1,
      redoDepth: 0,
    });
    expect(placementOf(repaired, STALE).typeVersion).toBe(1);
    expect(placementOf(repaired, STALE).params).toEqual({
      sprite: "assets/player_idle.png",
    });
    // Repaired, it loads: the preview draws it where it was authored.
    await expectPlacements(page, [
      factLine(STALE, { x: 0, y: -80 }, { sprite: "assets/player_idle.png" }),
    ]);
    await expect(page.getByTestId("reset-placement")).toBeHidden();

    // And one undo puts both back.
    await page.getByTestId("undo").click();
    const back = await draftAfter(request, token, {
      undoDepth: 0,
      redoDepth: 1,
    });
    expect(placementOf(back, STALE).typeVersion).toBe(2);
    expect(placementOf(back, STALE).params).toEqual({
      sprite: "assets/skeleton_idle.png",
      shadow: true,
    });
    await expectPlacements(page, []);
    await expect(page.getByTestId("reset-placement")).toBeVisible();
  });

  test("plays the unsaved draft, in a page the project wrote no code for", async ({
    page,
    context,
  }) => {
    await openEditor(page);
    const saved = savedPlacement(ROOT).transform.position;

    await dragPlacement(page, ROOT, { x: -80, y: 60 });
    await expect(page.getByTestId("dirty-marker")).toBeVisible();

    // Play opens with `noopener`, so the new page arrives on the context
    // rather than as this page's popup.
    const [play] = await Promise.all([
      context.waitForEvent("page"),
      page.getByTestId("play-level").click(),
    ]);

    // The level runs as it stands on screen, and nothing is written: the page
    // reads the draft the editor is holding. It is the editor's own page, so
    // the project contributed nothing to make this work.
    await waitForInspector(play);
    expect((await placementIn(play, ROOT)).world).not.toEqual(saved);
    expect(savedPlacement(ROOT).transform.position).toEqual(saved);
    expect(new URL(play.url()).pathname).toBe("/play.html");
    await expect(page.getByTestId("dirty-marker")).toBeVisible();
  });

  test("saves before running, and the game page loads the file", async ({
    page,
    context,
  }) => {
    await openEditor(page);
    const saved = savedPlacement(ROOT).transform.position;

    await dragPlacement(page, ROOT, { x: -80, y: 60 });
    await expect(page.getByTestId("run-level")).toHaveText("Save and Run");

    const [run] = await Promise.all([
      context.waitForEvent("page"),
      page.getByTestId("run-level").click(),
    ]);

    // The game reads the file, so Run writes it first. What the game shows and
    // what is on disk are the same thing, which is the question Run answers.
    await expect(page.getByTestId("dirty-marker")).toBeHidden();
    const written = savedPlacement(ROOT).transform.position;
    expect(written).not.toEqual(saved);
    await waitForInspector(run);
    expectPoint((await placementIn(run, ROOT)).world, written);
    // One parameter, naming the file. The game fetches it the way it would
    // fetch any level, and carries no editor code at all.
    expect(new URL(run.url()).searchParams.get("level")).toBe(level);
  });

  test("makes a level, builds it, runs it, copies it, and deletes the copy", async ({
    page,
    context,
    request,
  }) => {
    await openEditor(page);
    const token = await tokenOf(page);
    const name = `made-${String(levelCount)}`;
    const made = `levels/${name}.yage-level.json`;
    const copy = `levels/${name}-copy.yage-level.json`;

    // The viewport's height with no dialog over it, to come back to: the
    // dialog is a band above the body and takes the room while it is open.
    const viewport = await canvasHeight(page);

    // New asks for a name. The path follows it, under the directory the
    // config's one level glob names.
    await page.getByTestId("new-level").click();
    await page.getByTestId("level-name").fill(name);
    await expect(page.getByTestId("level-path")).toHaveValue(made);
    await page.getByTestId("create-level").click();

    // Listed and open with nothing in it, and with no reload: the create
    // answered with the level's summary and its draft. The dialog stays up
    // until the level it asked for is the open one, which is what makes a
    // refusal answerable in front of what was typed.
    const picker = page.getByTestId("level-picker");
    await expect(picker).toHaveValue(made);
    await expect(picker.locator("option")).toHaveText([level, made]);
    await expect(page.getByTestId("level-dialog")).toBeHidden();
    await expect.poll(() => canvasHeight(page)).toBe(viewport);
    await expectPlacements(page, []);

    await openActors(page);
    await page.getByTestId("place-game.crate").click();
    const placed = await draftAfter(
      request,
      token,
      { undoDepth: 1, redoDepth: 0 },
      made,
    );
    const built = placed.document.entities[0];
    if (!built) throw new Error("the Actors strip created no placement.");

    const [run] = await Promise.all([
      context.waitForEvent("page"),
      page.getByTestId("run-level").click(),
    ]);

    // The file the editor made is a level the game loads like any other.
    await expect(page.getByTestId("dirty-marker")).toBeHidden();
    expect(savedPlacements(made).map((one) => one.id)).toEqual([built.id]);
    expect(new URL(run.url()).searchParams.get("level")).toBe(made);
    await waitForInspector(run);
    expectPoint(
      (await placementIn(run, built.id)).world,
      built.transform.position,
    );

    // A duplicate is the file with a new level id: the same placement, at the
    // same id, in a second file that opens on the spot.
    await page.getByTestId("duplicate-level").click();
    await expect(page.getByTestId("level-path")).toHaveValue(copy);
    await page.getByTestId("create-level").click();
    await expect(picker).toHaveValue(copy);
    await expect(page.getByTestId("level-dialog")).toBeHidden();
    // `-copy` sorts above `.yage-level.json`, so the copy is listed first.
    await expect(picker.locator("option")).toHaveText([level, copy, made]);
    await expectPlacements(page, [
      factLine(built.id, built.transform.position, { sprite: spriteOf(ROOT) }),
    ]);
    expect(savedPlacements(copy).map((one) => one.id)).toEqual([built.id]);

    // Deleting asks first, and lands on the level that takes its place.
    await page.getByTestId("delete-level").click();
    await page.getByTestId("confirm-delete-level").click();
    await expect(picker).toHaveValue(made);
    await expect(picker.locator("option")).toHaveText([level, made]);
    expect(existsSync(path.join(LEVELS, path.basename(copy)))).toBe(false);

    await expect(page.getByTestId("diagnostics")).toBeHidden();
  });

  test("puts a placement on a layer, orders it, and the game draws it there", async ({
    page,
    context,
  }) => {
    await openEditor(page);
    await page.getByTestId(`hierarchy-row-${ROOT}`).click();

    // The picker offers what `editor/config.ts` declared for this glob, minus
    // the screen-space layer a level must never target and the default a
    // placement is already on.
    const picker = page.getByTestId("placement-layer");
    await expect(picker.locator("option")).toHaveText([
      "Default",
      "bg",
      "props",
      "canopy (sorted)",
    ]);

    // On a layer with no sort, the four ordering controls are live and each
    // one moves the placement among the placements sharing its parent.
    await picker.selectOption("props");
    await expect(page.getByTestId("order-front")).toBeEnabled();
    await page.getByTestId("order-front").click();

    // A layer that keys its own order switches them off and says why, so the
    // check goes back to `props` before the level is saved.
    await picker.selectOption("canopy");
    await expect(page.getByTestId("order-front")).toBeDisabled();
    await expect(page.getByTestId("order-sorted-note")).toBeVisible();
    await picker.selectOption("props");

    await page.getByTestId("save-level").click();
    await expect(page.getByTestId("dirty-marker")).toBeHidden();
    expect(savedPlacement(ROOT).layer).toBe("props");
    expect(savedPlacement(LATER).layer).toBeUndefined();
    // Later in the document is later in add order, which is what draws on top.
    expect(savedPlacements().map((placement) => placement.id)).toEqual([
      CHILD,
      LATER,
      ROOT,
    ]);

    // The layer the file names is the layer the running game parents the
    // sprite to — read off the display tree, not off the document.
    const game = await context.newPage();
    await game.goto(`/game.html?file=/${level}`);
    await waitForInspector(game);
    expect((await placementIn(game, ROOT)).layer).toBe("props");
    expect((await placementIn(game, LATER)).layer).toBe("default");
    // And the editor's preview agrees, which is the whole point of declaring
    // the set in the config.
    expect((await placementIn(page, ROOT)).layer).toBe("props");
  });

  test("edits two placements at once, and takes them out of the game", async ({
    page,
    context,
  }) => {
    await openEditor(page);
    await page.getByTestId(`hierarchy-row-${ROOT}`).click();
    await page
      .getByTestId(`hierarchy-row-${LATER}`)
      .click({ modifiers: ["ControlOrMeta"] });

    // One control over both roots: one command, so one undo would take both
    // back, and the file has the layer on each of them.
    await page.getByTestId("placement-layer").selectOption("props");
    await page.getByTestId("save-level").click();
    await expect(page.getByTestId("dirty-marker")).toBeHidden();
    expect(savedPlacement(ROOT).layer).toBe("props");
    expect(savedPlacement(LATER).layer).toBe("props");

    const drawn = await context.newPage();
    await drawn.goto(`/game.html?file=/${level}`);
    await waitForInspector(drawn);
    expect((await placementIn(drawn, ROOT)).layer).toBe("props");
    expect((await placementIn(drawn, LATER)).layer).toBe("props");
    expect((await placementIn(drawn, ROOT)).active).toBe(true);
    await drawn.close();

    // The active flag is authored game state: unticking it is what makes the
    // running game start these placements switched off, and a child follows
    // the placement it is under.
    await page.getByTestId("placement-active").uncheck();
    await page.getByTestId("save-level").click();
    await expect(page.getByTestId("dirty-marker")).toBeHidden();
    expect(savedPlacement(ROOT).active).toBe(false);
    expect(savedPlacement(LATER).active).toBe(false);

    const off = await context.newPage();
    await off.goto(`/game.html?file=/${level}`);
    await waitForInspector(off);
    expect((await placementIn(off, ROOT)).active).toBe(false);
    expect((await placementIn(off, LATER)).active).toBe(false);
    expect((await placementIn(off, CHILD)).active).toBe(false);
  });

  test("lines three crates up on their top edges, and the game loads it", async ({
    page,
    context,
    request,
  }) => {
    await openEditor(page);
    const token = await tokenOf(page);

    // Three crates from the Actors strip. Each one lands a step down and to
    // the right of the last, because the middle of the view is taken by then —
    // so the three start at three different heights without a drag.
    await openActors(page);
    for (let round = 1; round <= 3; round += 1) {
      await page.getByTestId("place-game.crate").click();
      await draftAfter(request, token, { undoDepth: round, redoDepth: 0 });
    }
    const built = (await draftOf(request, token)).document.entities
      .filter((entity) => !(entity.id in AUTHORED))
      .map((entity) => entity.id);
    expect(built).toHaveLength(3);
    const before = await draftOf(request, token);
    const heights = built.map((id) => positionOf(before, id).y);
    expect(new Set(heights).size).toBe(3);

    // All three at the top level, so they share a parent and the Arrange group
    // is offered.
    for (const [index, id] of built.entries()) {
      await page
        .getByTestId(`hierarchy-row-${id}`)
        .click(index === 0 ? {} : { modifiers: ["ControlOrMeta"] });
    }
    await page.getByTestId("align-top").click();

    // One command over the two that had to move, so one undo takes the whole
    // arrangement back.
    const aligned = await draftAfter(request, token, {
      undoDepth: 4,
      redoDepth: 0,
    });
    const tops = built.map((id) => positionOf(aligned, id).y);
    expect(tops[1]).toBeCloseTo(tops[0] ?? 0, 5);
    expect(tops[2]).toBeCloseTo(tops[0] ?? 0, 5);
    // The three authored placements are untouched: an arrangement acts on the
    // selection and nothing else.
    expectPoint(positionOf(aligned, ROOT), authored(ROOT));

    await page.getByTestId("save-level").click();
    await expect(page.getByTestId("dirty-marker")).toBeHidden();

    // Every crate draws the same artwork at the same scale, so equal top edges
    // are equal origins — which is what the game page reports.
    const game = await context.newPage();
    await game.goto(`/game.html?file=/${level}`);
    await waitForInspector(game);
    const worlds: number[] = [];
    for (const id of built) worlds.push((await placementIn(game, id)).world.y);
    expect(worlds[1]).toBeCloseTo(worlds[0] ?? 0, 5);
    expect(worlds[2]).toBeCloseTo(worlds[0] ?? 0, 5);
  });

  test("accepts one of two commands sent against one revision", async ({
    page,
    request,
  }) => {
    await openEditor(page);
    const token = await tokenOf(page);

    const { epoch } = await get<{ epoch: string }>(
      request,
      `${API}/bootstrap`,
      token,
    );
    const opened = await draftOf(request, token);
    const data = {
      epoch,
      expectedDraftRevision: opened.draftRevision,
      command: moveCommand("race", { x: 5, y: 5 }),
    };

    const outcomes = await Promise.all(
      [0, 1].map(async () =>
        post(request, `${API}/draft/command?path=${level}`, token, data),
      ),
    );

    expect(statuses(outcomes, "accepted")).toBe(1);
    expect(statuses(outcomes, "stale")).toBe(1);
  });

  test("accepts one of two undos sent against one revision", async ({
    page,
    request,
  }) => {
    await openEditor(page);
    const token = await tokenOf(page);

    const { epoch } = await get<{ epoch: string }>(
      request,
      `${API}/bootstrap`,
      token,
    );
    const opened = await draftOf(request, token);
    // An entry for the two undos to compete over. An empty history is the one
    // case that cannot race: it answers `accepted` without moving the revision.
    const moved = await post(
      request,
      `${API}/draft/command?path=${level}`,
      token,
      {
        epoch,
        expectedDraftRevision: opened.draftRevision,
        command: moveCommand("undo-race", { x: 5, y: 5 }),
      },
    );
    expect(moved.status).toBe("accepted");

    const data = {
      epoch,
      expectedDraftRevision: moved.snapshot.draftRevision,
    };
    const outcomes = await Promise.all(
      [0, 1].map(async () =>
        post(request, `${API}/draft/undo?path=${level}`, token, data),
      ),
    );

    // Undo is a step in the same queue a command enters, so the second one is
    // stale for naming a revision the first has already replaced.
    expect(statuses(outcomes, "accepted")).toBe(1);
    expect(statuses(outcomes, "stale")).toBe(1);

    // The entry was replayed once: the move is back where it started, and it
    // moved to the redo side rather than being consumed twice.
    const after = await draftOf(request, token);
    expect(after.history).toEqual({ undoDepth: 0, redoDepth: 1 });
    expect(positionOf(after, ROOT)).toEqual(AUTHORED[ROOT]);
  });

  test("drags a parameter's point to a place in the level", async ({
    page,
    request,
  }) => {
    // The whole path for a value that is a place: the declaration, the handle
    // the overlay draws, the drag, the command, and the number in the file.
    await openEditor(page);
    const token = await tokenOf(page);
    await withoutSnapping(page);

    await openActors(page);
    await page.getByTestId("place-game.slime").click();
    const placed = await draftAfter(request, token, {
      undoDepth: 1,
      redoDepth: 0,
    });
    const slime = placed.document.entities.find(
      (entity) => entity.type === "game.slime",
    );
    if (!slime) throw new Error("the Actors strip placed no slime.");
    expect(slime.params["patrolEnd"]).toEqual(SLIME_PATROL_END);

    // The handle sits at the placement's own origin plus its declared default,
    // which an unturned, unscaled placement draws in world space unchanged.
    const origin = slime.transform.position;
    const handle = offset(origin, SLIME_PATROL_END);
    const drag = { x: 90, y: -50 };
    const reached = offset(handle, await expectedWorldDelta(page, drag));

    await dragFrom(page, handle, drag);

    // One drag is one edit and one undo entry, the way a pose drag is.
    await draftAfter(request, token, { undoDepth: 2, redoDepth: 0 });
    // The inspector's two boxes show what the handle reached, in the frame the
    // value is stored in.
    const local = { x: reached.x - origin.x, y: reached.y - origin.y };
    expectPoint(
      {
        x: Number(await page.getByTestId("field-patrolEnd-x").inputValue()),
        y: Number(await page.getByTestId("field-patrolEnd-y").inputValue()),
      },
      local,
    );
    // The preview set the slime up again, and its `setup()` received the
    // world point the relative value resolves to, not the stored pair.
    await expectSlimeTarget(page, reached);

    // Moving the slime moves the place its point resolves to, so the preview
    // sets it up once more rather than only writing the new pose.
    const nudge = { x: 40, y: 30 };
    const carried = await expectedWorldDelta(page, nudge);
    // Pressed on the selected slime's own origin, where its gizmo's centre
    // grip is, which moves it the way a press on its body would.
    await dragFrom(page, origin, nudge);
    await draftAfter(request, token, { undoDepth: 3, redoDepth: 0 });
    await expectSlimeTarget(page, offset(reached, carried));

    await page.getByTestId("save-level").click();
    await expect(page.getByTestId("dirty-marker")).toBeHidden();

    const saved = savedPlacement(slime.id).params["patrolEnd"] as Point;
    expectPoint(saved, local);
  });

  test("edits one parameter of every kind, and the game decodes what it saved", async ({
    page,
    context,
    request,
  }) => {
    // The width of the parameter system in one pass: a level made from
    // nothing, a placement declaring one field of every kind the inspector
    // draws a control for, an edit through each of those controls, three of
    // them taken back and put forward, and the running game read for what its
    // `setup()` received.
    await openEditor(page);
    const token = await tokenOf(page);

    const name = `params-${String(levelCount)}`;
    const made = `levels/${name}.yage-level.json`;
    await page.getByTestId("new-level").click();
    await page.getByTestId("level-name").fill(name);
    await page.getByTestId("create-level").click();
    await expect(page.getByTestId("level-picker")).toHaveValue(made);
    await expectPlacements(page, []);
    await withoutSnapping(page);

    await openActors(page);
    await page.getByTestId("place-game.slime").click();
    const placed = await draftAfter(
      request,
      token,
      { undoDepth: 1, redoDepth: 0 },
      made,
    );
    const slime = placed.document.entities[0];
    if (!slime) throw new Error("the Actors strip placed no slime.");

    // Every step below is one edit, and waiting for the depth it produces is
    // what says so: a control that wrote twice, or not at all, fails here
    // rather than in the value the game reads at the end.
    let edits = 1;
    const edited = async (): Promise<void> => {
      edits += 1;
      await draftAfter(
        request,
        token,
        { undoDepth: edits, redoDepth: 0 },
        made,
      );
    };

    // A number, inside the range its declaration names.
    await page.getByTestId("field-speed").fill("65");
    await page.getByTestId("field-speed").press("Enter");
    await edited();

    // A switch.
    await page.getByTestId("field-awake").uncheck();
    await edited();

    // One of the names the declaration lists.
    await page.getByTestId("field-facing").selectOption("right");
    await edited();

    // A pair of numbers, a box each. Two edits: a member commits at its own
    // path, so typing one leaves the other as it stands.
    await page.getByTestId("field-drift-x").fill("7");
    await page.getByTestId("field-drift-x").press("Enter");
    await edited();
    await page.getByTestId("field-drift-y").fill("-3");
    await page.getByTestId("field-drift-y").press("Enter");
    await edited();

    // The place the point names, moved by its handle in the viewport rather
    // than by its boxes.
    const origin = slime.transform.position;
    const handle = offset(origin, SLIME_PATROL_END);
    const drag = { x: 90, y: -50 };
    const patrolEnd = offset(handle, await expectedWorldDelta(page, drag));
    await dragFrom(page, handle, drag);
    await edited();

    // A list: two rows added, the first one changed so the order is visible,
    // and the two swapped.
    await page.getByTestId("field-spawns-add").click();
    await edited();
    await page.getByTestId("field-spawns-add").click();
    await edited();
    await page.getByTestId("field-spawns.0.type").selectOption("bat");
    await edited();
    await page.getByTestId("field-spawns-down-0").click();
    await edited();

    // A colour, typed as the hex the file keeps.
    await page.getByTestId("field-tint").fill("#ff8800");
    await page.getByTestId("field-tint").press("Enter");
    await edited();

    // A value the game decodes for itself, edited through the control its
    // declaration named.
    await page.getByTestId("field-pace").selectOption("fast");
    await edited();

    // The last three back, and forward again. Each control shows the state at
    // the depth it is standing on, which is what says the inverse was exact.
    const total = edits;
    for (let depth = total - 1; depth >= total - 3; depth -= 1) {
      await page.getByTestId("undo").click();
      await draftAfter(
        request,
        token,
        { undoDepth: depth, redoDepth: total - depth },
        made,
      );
    }
    await expect(page.getByTestId("field-pace")).toHaveValue("slow");
    await expect(page.getByTestId("field-tint")).toHaveValue("#88ff88");
    await expect(page.getByTestId("field-spawns.0.type")).toHaveValue("bat");

    for (let depth = total - 2; depth <= total; depth += 1) {
      await page.getByTestId("redo").click();
      await draftAfter(
        request,
        token,
        { undoDepth: depth, redoDepth: total - depth },
        made,
      );
    }
    await expect(page.getByTestId("field-pace")).toHaveValue("fast");
    await expect(page.getByTestId("field-tint")).toHaveValue("#ff8800");
    await expect(page.getByTestId("field-spawns.0.type")).toHaveValue("slime");

    await page.getByTestId("save-level").click();
    await expect(page.getByTestId("dirty-marker")).toBeHidden();

    // The file keeps what was authored: the point in the slime's own frame,
    // the colour as its text, and the custom value as the name the control
    // offered.
    const saved = savedPlacement(slime.id, made).params;
    expectPoint(saved["patrolEnd"] as Point, {
      x: patrolEnd.x - origin.x,
      y: patrolEnd.y - origin.y,
    });
    expect(saved["tint"]).toBe("#ff8800");
    expect(saved["pace"]).toBe("fast");

    const [run] = await Promise.all([
      context.waitForEvent("page"),
      page.getByTestId("run-level").click(),
    ]);
    expect(new URL(run.url()).searchParams.get("level")).toBe(made);
    await waitForInspector(run);
    await expectSlimeTarget(run, patrolEnd);

    // What `setup()` was handed, every field of it: the eight that were edited
    // and the seven left at the declaration's default, each decoded to the
    // type its kind promises rather than to the JSON the file holds.
    const [fact] = await slimesIn(run);
    if (!fact) throw new Error("the game page loaded no slime.");
    const { patrolEnd: decoded, ...rest } = fact.params;
    expect(rest).toEqual({
      speed: 65,
      coins: 3,
      awake: false,
      title: "Slime",
      notes: "",
      facing: "right",
      mood: "calm",
      drift: [7, -3],
      home: [0, 0],
      loot: { item: "coin", count: 1 },
      spawns: [
        { type: "slime", delay: 1 },
        { type: "bat", delay: 1 },
      ],
      noise: { seed: 1 },
      tint: 0xff8800,
      pace: 120,
    });
    expectPoint(decodedPoint(decoded), patrolEnd);

    await expect(page.getByTestId("diagnostics")).toBeHidden();
  });

  test("hides a placement out of the way and never out of the file", async ({
    page,
  }) => {
    await openEditor(page);
    await withoutSnapping(page);

    // The template keeps its three placements apart, so one has to be moved
    // onto another for "what was underneath" to mean anything.
    const over = await clientPointOf(page, authored(ROOT));
    const from = await clientPointOf(page, authored(CHILD));
    await dragPlacement(page, CHILD, {
      x: over.x - from.x,
      y: over.y - from.y,
    });
    await page.getByTestId("save-level").click();
    await expect(page.getByTestId("dirty-marker")).toBeHidden();

    /**
     * Put the selection on the far placement, so the gizmo is nowhere near the
     * point the next press lands on: a press on the gizmo drags the selection
     * it is drawn for instead of choosing something else.
     */
    const selectFarPlacement = async (): Promise<void> => {
      await page.getByTestId(`hierarchy-row-${LATER}`).click();
    };

    // The child is authored after the root, so it is the one drawn on top and
    // the one a press finds.
    await selectFarPlacement();
    await page.mouse.click(over.x, over.y);
    await expect(page.getByTestId(`hierarchy-item-${CHILD}`)).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await page.getByTestId(`hierarchy-eye-${CHILD}`).click();
    await expect(page.getByTestId(`hierarchy-row-${CHILD}`)).toHaveClass(
      /is-hidden/,
    );

    await selectFarPlacement();
    await page.mouse.click(over.x, over.y);
    await expect(page.getByTestId(`hierarchy-item-${ROOT}`)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByTestId(`hierarchy-item-${CHILD}`)).toHaveAttribute(
      "aria-selected",
      "false",
    );

    // Hiding is the editor's own state: no edit was made, so there is nothing
    // to save, and Save stays off.
    await expect(page.getByTestId("dirty-marker")).toBeHidden();
    await expect(page.getByTestId("save-level")).toBeDisabled();

    // Shift-H puts everything back, and the press finds the child again.
    await page.keyboard.press("Shift+H");
    await expect(page.getByTestId(`hierarchy-row-${CHILD}`)).not.toHaveClass(
      /is-hidden/,
    );
    await selectFarPlacement();
    await page.mouse.click(over.x, over.y);
    await expect(page.getByTestId(`hierarchy-item-${CHILD}`)).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

/**
 * Drop a hierarchy row on the area under the tree, which makes it top-level.
 *
 * The drop targets exist only while a drag is running, so the drag has to be
 * open before the destination can be found — and opening it changes the
 * layout, which is why the box is measured after the pointer is down rather
 * than before.
 */
async function dragRowToRoot(page: Page, id: string): Promise<void> {
  await dragRow(page, id, () => page.getByTestId("drop-root"));
}

/** Drop a row on the strip above another row: same parent, that position. */
async function dragRowBefore(
  page: Page,
  id: string,
  siblingId: string,
): Promise<void> {
  await dragRow(page, id, () => page.getByTestId(`drop-before-${siblingId}`));
}

/** Drop a row on the middle of another row, which makes it the last child. */
async function dragRowInto(
  page: Page,
  id: string,
  parentId: string,
): Promise<void> {
  await dragRow(page, id, () => page.getByTestId(`drop-into-${parentId}`));
}

async function dragRow(
  page: Page,
  id: string,
  target: () => Locator,
): Promise<void> {
  const row = await boxOf(page.getByTestId(`hierarchy-row-${id}`));
  await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2);
  await page.mouse.down();
  // One move with the button down is what starts the HTML drag; the drop
  // targets are rendered from that point on.
  await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2 + 8);

  const zone = await boxOf(target());
  const to = { x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 };
  // Two moves over the target: the first is what the element reacts to, and
  // the second is dispatched while it is already the drop target.
  await page.mouse.move(to.x, to.y);
  await page.mouse.move(to.x, to.y + 1);
  await page.mouse.up();
}

async function boxOf(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("the element has no box");
  return box;
}

/** A command moving the template's root placement, for the race paths. */
function moveCommand(commandId: string, position: Point): unknown {
  return {
    kind: "set-poses",
    commandId,
    poses: [
      {
        id: ROOT,
        transform: { position, rotation: 0, scale: { x: 1, y: 1 } },
      },
    ],
  };
}

function statuses(
  outcomes: readonly DraftOutcomeView[],
  status: string,
): number {
  return outcomes.filter((outcome) => outcome.status === status).length;
}

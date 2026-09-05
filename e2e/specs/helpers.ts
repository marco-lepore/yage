import type { Page } from "@playwright/test";

export interface EntitySnapshot {
  id: number;
  name: string;
  tags: string[];
  components: string[];
  /** `entity.isActive` — false for a dormant entity, e.g. a parked pool member. */
  active: boolean;
  position?: { x: number; y: number };
}

export interface SceneSnapshot {
  name: string;
  entityCount: number;
  paused: boolean;
}

export interface EngineSnapshot {
  frame: number;
  sceneStack: SceneSnapshot[];
  entityCount: number;
  systemCount: number;
  errors: {
    callbackErrors: Array<{
      kind: string;
      error: string;
      entity?: string;
      scene?: string;
      event?: string;
    }>;
  };
}

export async function gotoFixture(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await waitForInspector(page);
}

export async function waitForInspector(page: Page): Promise<void> {
  // The global appears as start() begins, so its presence alone says nothing
  // about how far boot got. `ready` settles when start() finished, and a boot
  // failure rejects it — reported here instead of timing out.
  await page.waitForFunction(() => window.__yage__ !== undefined);
  await page.evaluate(() => window.__yage__?.ready);
}

export async function waitForClock(page: Page): Promise<void> {
  // DebugPlugin attaches the clock in its onStart hook, which `ready` covers,
  // so freeze() is safe by the time this returns.
  await waitForInspector(page);
  await page.evaluate(() => {
    const inspector = window.__yage__?.inspector;
    if (!inspector) {
      throw new Error("__yage__.inspector is not available.");
    }
    if (!inspector.time.isFrozen()) inspector.time.freeze();
  });
}

export async function stepFrame(page: Page, dtMs?: number): Promise<void> {
  await page.evaluate(async (dt) => {
    const inspector = window.__yage__?.inspector;
    if (!inspector) {
      throw new Error("__yage__.inspector is not available.");
    }
    if (dt !== undefined) {
      inspector.time.setDelta(dt);
    }
    await inspector.time.stepAsync(1);
  }, dtMs);
}

export async function stepFrames(
  page: Page,
  count: number,
  dtMs?: number,
): Promise<void> {
  await page.evaluate(
    async ({ frames, dt }) => {
      const inspector = window.__yage__?.inspector;
      if (!inspector) {
        throw new Error("__yage__.inspector is not available.");
      }
      if (dt !== undefined) {
        inspector.time.setDelta(dt);
      }
      await inspector.time.stepAsync(frames);
    },
    { frames: count, dt: dtMs },
  );
}

export async function waitForSceneStackLength(
  page: Page,
  expectedLength: number,
  timeout = 5_000,
): Promise<void> {
  await page.waitForFunction(
    (len) => window.__yage__?.inspector.getSceneStack().length === len,
    expectedLength,
    { timeout },
  );
}

// Async scene ops (push/pop/replace) can resolve while the stack is mid-swap —
// replace() briefly empties it. Gate on the expected top scene by name, which
// length can't distinguish when two states share a count (base vs replacement).
export async function waitForTopScene(
  page: Page,
  name: string,
  timeout = 5_000,
): Promise<void> {
  await page.waitForFunction(
    (n) => window.__yage__?.inspector.getSceneStack().at(-1)?.name === n,
    name,
    { timeout },
  );
}

export async function getSceneStack(page: Page): Promise<SceneSnapshot[]> {
  return page.evaluate(() => {
    const g = window.__yage__;
    if (!g) throw new Error("__yage__ not available");
    return g.inspector.getSceneStack();
  });
}

export async function getSnapshot(page: Page): Promise<EngineSnapshot> {
  return page.evaluate(() => {
    const g = window.__yage__;
    if (!g) throw new Error("__yage__ not available");
    return g.inspector.snapshot();
  });
}

export async function getEntityByName(
  page: Page,
  name: string,
): Promise<EntitySnapshot | undefined> {
  return page.evaluate((entityName) => {
    const g = window.__yage__;
    if (!g) throw new Error("__yage__ not available");
    return g.inspector.getEntityByName(entityName);
  }, name);
}

export async function getEntityPosition(
  page: Page,
  name: string,
): Promise<{ x: number; y: number } | undefined> {
  return page.evaluate((entityName) => {
    const g = window.__yage__;
    if (!g) throw new Error("__yage__ not available");
    return g.inspector.getEntityPosition(entityName);
  }, name);
}

export async function getComponentData<T>(
  page: Page,
  entityName: string,
  componentClass: string,
): Promise<T | undefined> {
  return page.evaluate(
    ({ entityName: name, componentClass: cls }) => {
      const g = window.__yage__;
      if (!g) throw new Error("__yage__ not available");
      return g.inspector.getComponentData(name, cls) as T | undefined;
    },
    { entityName, componentClass },
  );
}

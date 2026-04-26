import type { Page } from "@playwright/test";

export interface EntitySnapshot {
  id: number;
  name: string;
  tags: string[];
  components: string[];
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
    disabledSystems: string[];
    disabledComponents: Array<{
      entity: string;
      component: string;
      error: string;
    }>;
  };
}

export async function gotoFixture(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await waitForInspector(page);
}

export async function waitForInspector(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__yage__?.inspector !== undefined);
}

export async function waitForClock(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__yage__?.inspector?.time !== undefined);
  await page.evaluate(() => {
    const inspector = window.__yage__?.inspector;
    if (!inspector) {
      throw new Error("__yage__.inspector is not available.");
    }
    if (!inspector.time.isFrozen()) {
      inspector.time.freeze();
    }
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
    await inspector.time.step(1);
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
      await inspector.time.step(frames);
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

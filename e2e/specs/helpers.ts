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
  frameCount: number;
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
  return page.evaluate(() => window.__yage__!.inspector.getSceneStack());
}

export async function getSnapshot(page: Page): Promise<EngineSnapshot> {
  return page.evaluate(() => window.__yage__!.inspector.snapshot());
}

export async function getEntityByName(
  page: Page,
  name: string,
): Promise<EntitySnapshot | undefined> {
  return page.evaluate((entityName) => {
    return window.__yage__!.inspector.getEntityByName(entityName);
  }, name);
}

export async function getEntityPosition(
  page: Page,
  name: string,
): Promise<{ x: number; y: number } | undefined> {
  return page.evaluate((entityName) => {
    return window.__yage__!.inspector.getEntityPosition(entityName);
  }, name);
}

export async function getComponentData<T>(
  page: Page,
  entityName: string,
  componentClass: string,
): Promise<T | undefined> {
  return page.evaluate(
    ({ entityName: name, componentClass: cls }) => {
      return window.__yage__!.inspector.getComponentData(name, cls) as
        | T
        | undefined;
    },
    { entityName, componentClass },
  );
}

import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { gotoFixture } from "./helpers.js";

/** The cases the fixture mounts, in the order it mounts them. */
export const CASE_NAMES = [
  "sprites",
  "text-ui",
  "masks",
  "render-targets",
  "effects",
  "lighting",
  "physics",
  "workers",
  "audio",
  "input",
  "saves",
  "lifecycle",
  "display",
];

export interface BaselineReading {
  target: string;
  profile: string;
  bootId: string;
  cases: string[];
  settledCases: string[];
  settled: boolean;
  readings: Record<string, Record<string, unknown>>;
  host: {
    info: { runtime: string; os: string };
    lifecycle: { activity: string; visibility: string; focus: string };
    active: boolean;
  };
  errors: { callbackErrors: unknown[] };
  graphicsContext: boolean[];
  userAgent: string;
}

export type BaselinePixel = [number, number, number, number];

export interface BaselineExtension {
  read(): BaselineReading;
  pointFor(x: number, y: number): { x: number; y: number };
  pixels(): Record<string, BaselinePixel>;
  loseContext(): Promise<void>;
}

export interface LightingSceneDiagnostics {
  scene: string;
  renderer: string;
  fallback: { reason: string; detail: string | null } | null;
  bounce: { requested: string; drawn: string } | null;
}

export function readPixels(page: Page): Promise<Record<string, BaselinePixel>> {
  return page.evaluate(() =>
    window
      .__yage__!.inspector.getExtension<BaselineExtension>("baseline")!
      .pixels(),
  );
}

export function readLighting(page: Page): Promise<LightingSceneDiagnostics[]> {
  return page.evaluate(() => {
    const extension = window.__yage__!.inspector.getExtension<{
      scenes(): LightingSceneDiagnostics[];
    }>("lighting");
    return extension ? extension.scenes() : [];
  });
}

export async function openBaseline(page: Page, query = ""): Promise<void> {
  await gotoFixture(page, `/baseline.html${query}`);
  await page.waitForFunction(
    () => window.__yage__?.inspector?.getExtension("baseline") !== undefined,
  );
}

export function read(page: Page): Promise<BaselineReading> {
  return page.evaluate(() =>
    window
      .__yage__!.inspector.getExtension<BaselineExtension>("baseline")!
      .read(),
  );
}

export async function waitForSettled(
  page: Page,
  timeout = 30_000,
): Promise<void> {
  await page.waitForFunction(
    () =>
      window.__yage__?.inspector
        ?.getExtension<BaselineExtension>("baseline")
        ?.read().settled === true,
    null,
    { timeout },
  );
}

/** The reading of one case, after it settled. */
export async function readCase(
  page: Page,
  name: string,
): Promise<Record<string, unknown>> {
  await openBaseline(page, `?case=${name}`);
  await waitForSettled(page);
  const reading = await read(page);
  expect(reading.cases).toEqual([name]);
  expect(reading.errors.callbackErrors).toEqual([]);
  return reading.readings[name]!;
}

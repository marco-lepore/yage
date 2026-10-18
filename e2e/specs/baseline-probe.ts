import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { LightingSceneDiagnostics } from "@yagejs/lighting";
import type { CaseName } from "../fixtures/src/baseline/cases.js";
import type { CaseReading } from "../fixtures/src/baseline/probe.js";
import type {
  BaselineExtension,
  BaselinePixel,
  BaselineReading,
} from "../fixtures/src/baseline/types.js";
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

export type { BaselineExtension, BaselinePixel, BaselineReading };

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
  // The page publishes its extension before the scene enters, so the wait
  // runs until every case the page mounts has a reading of its own.
  await page.waitForFunction(() => {
    const reading = window.__yage__?.inspector
      ?.getExtension<{
        read(): { cases: string[]; readings: object };
      }>("baseline")
      ?.read();
    if (reading === undefined) return false;
    const readings = reading.readings as Record<string, unknown>;
    return reading.cases.every((name) => readings[name] !== undefined);
  });
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
  name: CaseName,
): Promise<CaseReading> {
  await openBaseline(page, `?case=${name}`);
  await waitForSettled(page);
  const reading = await read(page);
  expect(reading.cases).toEqual([name]);
  expect(reading.errors.callbackErrors).toEqual([]);
  return reading.readings[name]!;
}

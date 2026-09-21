import { expect, test } from "@playwright/test";
import {
  BORDER_PROBES,
  CONE_PROBES,
  INSIDE_WALL,
  LIT,
  SHADOWED,
  expectPictureMatchesQuery,
  levelsAlong,
  open,
  setIntensities,
} from "./lighting-soft-probe.js";

test.describe("Soft shadows", () => {
  test("draws the shadow border the query reports", async ({ page }) => {
    await open(page, "?renderer=shader&size=24");
    await setIntensities(page, 1, 0);

    const levels = await levelsAlong(page, BORDER_PROBES);

    // The probes cross a border rather than sitting in one shade, and it is a
    // band of part-lit values rather than a step between two.
    expect(Math.min(...levels.queried)).toBeLessThan(0.1);
    expect(Math.max(...levels.queried)).toBeGreaterThan(0.4);
    const inside = levels.queried.filter((level) => level > 0.1 && level < 0.4);
    expect(inside.length).toBeGreaterThanOrEqual(2);

    expectPictureMatchesQuery(levels);
  });

  test("draws a point lamp's hard shadow exactly", async ({ page }) => {
    await open(page, "?renderer=shader&size=0");
    await setIntensities(page, 1, 0);

    const levels = await levelsAlong(page, [SHADOWED, LIT]);

    expect(levels.queried[0]).toBe(0);
    expect(levels.queried[1]).toBeGreaterThan(0.5);
    expectPictureMatchesQuery(levels);
  });

  test("keeps the overlay's hard edge inside the border the query answers", async ({
    page,
  }) => {
    await open(page, "?renderer=shader&size=24");
    await setIntensities(page, 1, 0);
    const soft = await levelsAlong(page, BORDER_PROBES);

    await open(page, "?renderer=overlay&size=24");
    await setIntensities(page, 1, 0);
    const hard = await levelsAlong(page, BORDER_PROBES);

    // The query is the truth whichever renderer draws it.
    expect(hard.queried).toEqual(soft.queried);

    let disagreed = false;
    for (const [index, level] of hard.queried.entries()) {
      const drawn = hard.drawn[index] ?? 0;
      // Outside the border both renderers draw what the query says.
      if (level < 0.05 || level > 0.45) {
        expect(Math.abs(drawn - level)).toBeLessThan(0.06);
        continue;
      }
      if (Math.abs(drawn - level) > 0.1) disagreed = true;
    }
    expect(disagreed).toBe(true);
  });
});

test.describe("Soft cone edges", () => {
  test("fades a spotlight over the share of its spread it is given", async ({
    page,
  }) => {
    await open(page, "?renderer=shader&softness=0.6");
    await setIntensities(page, 0, 1);

    const levels = await levelsAlong(page, CONE_PROBES);

    expect(Math.min(...levels.queried)).toBeLessThan(0.05);
    expect(Math.max(...levels.queried)).toBeGreaterThan(0.5);
    const inside = levels.queried.filter(
      (level) => level > 0.05 && level < 0.5,
    );
    expect(inside.length).toBeGreaterThanOrEqual(2);

    expectPictureMatchesQuery(levels);
  });

  test("ends a cone on a line when it is given no softness", async ({
    page,
  }) => {
    await open(page, "?renderer=shader&softness=0");
    await setIntensities(page, 0, 1);

    const levels = await levelsAlong(page, CONE_PROBES);

    for (const level of levels.queried) {
      expect(level === 0 || level > 0.5).toBe(true);
    }
    expectPictureMatchesQuery(levels);
  });
});

test.describe("Light inside a wall", () => {
  test("draws a pixel inside a wall dark when the lamp reaches into it", async ({
    page,
  }) => {
    await open(page, "?renderer=shader&size=24&lampX=232");
    await setIntensities(page, 1, 0);

    const levels = await levelsAlong(page, INSIDE_WALL);

    expect(levels.queried).toEqual([0, 0, 0, 0, 0]);
    expectPictureMatchesQuery(levels);
  });
});

import { expect, test, type Page } from "@playwright/test";
import {
  getComponentData,
  gotoFixture,
  stepFrames,
  waitForClock,
} from "./helpers";

interface ProbeData {
  lastLine: string;
  lineCount: number;
  lastChoice: string;
  choiceCount: number;
  choosing: boolean;
  ended: boolean;
  boxVisible: boolean;
  bubbleVisible: boolean;
}

/** The controller methods the fixture exposes on `window.__dialogue__`. */
interface HostHandle {
  advance(): void;
  choose(n: number): void;
  setAutoAdvance(ms: number | null): void;
  setHidden(hidden: boolean): void;
}

/**
 * Drive the conversation via the controller's input-agnostic host API (the same
 * calls the default `InputBinding` makes). Assertions read the Inspector probe,
 * never the controller — so the test depends only on `advance`/`choose`.
 */
async function advance(page: Page): Promise<void> {
  await page.evaluate(() =>
    (window as unknown as { __dialogue__: HostHandle }).__dialogue__.advance(),
  );
}

async function choose(page: Page, index: number): Promise<void> {
  await page.evaluate(
    (i) =>
      (window as unknown as { __dialogue__: HostHandle }).__dialogue__.choose(
        i,
      ),
    index,
  );
}

function probe(page: Page): Promise<ProbeData | undefined> {
  return getComponentData<ProbeData>(page, "dialogue-host", "DialogueProbe");
}

/**
 * Walk the conversation forward by `advance`-ing each frame until the probe
 * reports a choice is being presented (reveal-all then step-off both map to
 * `advance`). Bounded so a stall fails loudly. Deterministic: the clock is
 * frozen and the spec steps it.
 */
async function advanceUntilChoosing(page: Page, maxSteps = 200): Promise<void> {
  for (let i = 0; i < maxSteps; i++) {
    if ((await probe(page))?.choosing) return;
    await advance(page);
    await stepFrames(page, 1);
  }
  throw new Error("dialogue never reached a choice within the step budget");
}

async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate(
    (h) =>
      (window as unknown as { __dialogue__: HostHandle }).__dialogue__.setHidden(h),
    hidden,
  );
}

/** Advance until the line on screen contains `substr`, then STOP on it (the
 *  check happens before each advance, so we never step past the target line). */
async function advanceUntilLine(
  page: Page,
  substr: string,
  maxSteps = 200,
): Promise<void> {
  for (let i = 0; i < maxSteps; i++) {
    if ((await probe(page))?.lastLine.includes(substr)) return;
    await advance(page);
    await stepFrames(page, 1);
  }
  throw new Error(`dialogue never reached a line containing "${substr}"`);
}

test.describe("@yagejs-addons/dialogue addon", () => {
  test("shows a line and a choice advances the conversation", async ({
    page,
  }) => {
    await gotoFixture(page, "/dialogue-addon.html");
    await waitForClock(page);

    // Let the first line start revealing, then assert a line is showing.
    await stepFrames(page, 30);
    const first = await probe(page);
    expect(first?.lineCount).toBeGreaterThan(0);
    expect(first?.lastLine).toContain("Welcome to the");

    // Walk the three lines (welcome → mana → bubble) to the choice.
    await advanceUntilChoosing(page);

    const beforeChoice = await probe(page);
    expect(beforeChoice?.choosing).toBe(true);
    expect(beforeChoice?.choiceCount).toBe(0);
    const linesBeforeChoice = beforeChoice?.lineCount ?? 0;

    // Pick the first option ("Tell me more" → branches to the "more" node, which
    // shows "Branching works." before ending).
    await choose(page, 0);
    await stepFrames(page, 4);

    const after = await probe(page);
    // The choice was recorded…
    expect(after?.choiceCount).toBe(1);
    expect(after?.lastChoice).toContain("Tell me more");
    // …and it advanced the conversation: the branch's line appeared.
    expect(after?.lineCount).toBeGreaterThan(linesBeforeChoice);
    expect(after?.lastLine).toContain("Branching works");
    expect(after?.choosing).toBe(false);
  });

  test("auto-advance walks the lines to the choice with no manual input", async ({
    page,
  }) => {
    await gotoFixture(page, "/dialogue-addon.html");
    await waitForClock(page);

    // Turn on a short auto-advance, then never call advance(): the three intro
    // lines should reveal and step themselves, parking at the choice.
    await page.evaluate(
      (ms) =>
        (
          window as unknown as { __dialogue__: HostHandle }
        ).__dialogue__.setAutoAdvance(ms),
      200,
    );

    for (let i = 0; i < 150; i++) {
      if ((await probe(page))?.choosing) break;
      await stepFrames(page, 3);
    }

    const p = await probe(page);
    expect(p?.choosing).toBe(true); // reached the choice on its own
    expect(p?.lineCount).toBeGreaterThanOrEqual(3); // walked all three lines
  });

  test("hide/restore on a bubble line brings back the bubble, not the box frame", async ({
    page,
  }) => {
    await gotoFixture(page, "/dialogue-addon.html");
    await waitForClock(page);

    // Walk to the diegetic bubble line ("Down here, I speak from a bubble.").
    await advanceUntilLine(page, "bubble");
    const onBubble = await probe(page);
    expect(onBubble?.bubbleVisible).toBe(true); // the bubble is up...
    expect(onBubble?.boxVisible).toBe(false); // ...and the box frame is not

    // Cutscene takeover: hide the whole UI mid-line.
    await setHidden(page, true);
    await stepFrames(page, 1);
    const hidden = await probe(page);
    expect(hidden?.bubbleVisible).toBe(false);
    expect(hidden?.boxVisible).toBe(false);

    // Restore: the ACTIVE variant (bubble) must come back — the regression
    // was an empty BOX frame appearing here while the bubble stayed hidden.
    await setHidden(page, false);
    await stepFrames(page, 1);
    const restored = await probe(page);
    expect(restored?.bubbleVisible).toBe(true);
    expect(restored?.boxVisible).toBe(false);
    expect(restored?.lastLine).toContain("bubble"); // still the same line
  });
});

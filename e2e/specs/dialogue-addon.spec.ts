import { expect, test, type Page } from "@playwright/test";
import {
  getComponentData,
  gotoFixture,
  stepFrames,
  waitForClock,
} from "./helpers.js";

interface ProbeData {
  lastLine: string;
  lineCount: number;
  lastChoice: string;
  choiceCount: number;
  choosing: boolean;
  ended: boolean;
  shownOptions: string[];
  selectionIndex: number;
  markerName: string;
  markerCount: number;
  tickCount: number;
  boxVisible: boolean;
  bubbleVisible: boolean;
  texturedVisible: boolean;
  bubbleTextured: boolean;
  nameY: number;
  textX: number;
  avatarPresent: boolean;
}

/** The controller methods the fixture exposes on `window.__dialogue__`. */
interface HostHandle {
  advance(): void;
  choose(n: number): void;
  moveSelection(delta: number): void;
  setAutoAdvance(seconds: number | null): void;
  setHidden(hidden: boolean): void;
  play(script: unknown): void;
}

/** Switch the conversation to one of the extra scripts the fixture exposes
 *  (`hub` overflow, `textured` meta.chrome, `position`, `avatar`). */
async function playScript(
  page: Page,
  name: "hub" | "textured" | "position" | "avatar" | "marker",
): Promise<void> {
  await page.evaluate((key) => {
    const w = window as unknown as {
      __dialogue__: HostHandle;
      __scripts__: Record<string, unknown>;
    };
    w.__dialogue__.play(w.__scripts__[key]);
  }, name);
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

async function moveSelection(page: Page, delta: number): Promise<void> {
  await page.evaluate(
    (d) =>
      (
        window as unknown as { __dialogue__: HostHandle }
      ).__dialogue__.moveSelection(d),
    delta,
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

  test("a disabled choice is shown but cannot be selected or chosen", async ({
    page,
  }) => {
    await gotoFixture(page, "/dialogue-addon.html");
    await waitForClock(page);
    await advanceUntilChoosing(page);

    const atChoice = await probe(page);
    // The disabled row is on screen alongside the enabled options.
    expect(atChoice?.shownOptions).toContain("Locked path");
    expect(atChoice?.shownOptions).toContain("Tell me more");
    expect(atChoice?.choiceCount).toBe(0);

    // Committing the disabled option (original index 1) is refused.
    await choose(page, 1);
    await stepFrames(page, 4);
    const afterDisabled = await probe(page);
    expect(afterDisabled?.choiceCount).toBe(0); // nothing committed
    expect(afterDisabled?.choosing).toBe(true); // still on the menu

    // Keyboard nav skips the disabled row: from the first enabled option,
    // moving down lands on the next ENABLED option (original index 2), not 1.
    await moveSelection(page, 1);
    await stepFrames(page, 1);
    expect((await probe(page))?.selectionIndex).toBe(2);

    // The enabled option still commits and advances the conversation.
    await choose(page, 0);
    await stepFrames(page, 4);
    const after = await probe(page);
    expect(after?.choiceCount).toBe(1);
    expect(after?.lastChoice).toContain("Tell me more");
    expect(after?.lastLine).toContain("Branching works");
  });

  test("auto-advance walks the lines to the choice with no manual input", async ({
    page,
  }) => {
    await gotoFixture(page, "/dialogue-addon.html");
    await waitForClock(page);

    // Turn on a short auto-advance, then never call advance(): the three intro
    // lines should reveal and step themselves, parking at the choice.
    await page.evaluate(
      (seconds) =>
        (
          window as unknown as { __dialogue__: HostHandle }
        ).__dialogue__.setAutoAdvance(seconds),
      0.2,
    );

    for (let i = 0; i < 150; i++) {
      if ((await probe(page))?.choosing) break;
      await stepFrames(page, 3);
    }

    const p = await probe(page);
    expect(p?.choosing).toBe(true); // reached the choice on its own
    expect(p?.lineCount).toBeGreaterThanOrEqual(3); // walked all three lines
  });

  test("a nine-option hub stays navigable and commits the last option (overflow)", async ({
    page,
  }) => {
    await gotoFixture(page, "/dialogue-addon.html");
    await waitForClock(page);

    await playScript(page, "hub");
    await advanceUntilChoosing(page);

    const atHub = await probe(page);
    expect(atHub?.shownOptions).toHaveLength(9); // all nine rows are presented

    // Keyboard-nav down to the last (grown) row: every row is reachable.
    await moveSelection(page, 8);
    await stepFrames(page, 1);
    expect((await probe(page))?.selectionIndex).toBe(8);

    // The last option still commits — the grown list hit-tests/selects correctly.
    await choose(page, 8);
    await stepFrames(page, 4);
    const after = await probe(page);
    expect(after?.choiceCount).toBe(1);
    expect(after?.lastChoice).toContain("Door number 9");
  });

  test("meta.chrome swaps the box frame style, including the invisible none", async ({
    page,
  }) => {
    await gotoFixture(page, "/dialogue-addon.html");
    await waitForClock(page);

    await playScript(page, "textured");
    await stepFrames(page, 2);

    // Line 1 → a named textured nine-slice: the nine-slice host shows, the drawn
    // Graphics frame does not.
    await advanceUntilLine(page, "Parchment");
    await stepFrames(page, 1);
    const parchment = await probe(page);
    expect(parchment?.texturedVisible).toBe(true);
    expect(parchment?.boxVisible).toBe(false);

    // Line 2 → the built-in "none" style: no frame at all.
    await advanceUntilLine(page, "No frame");
    await stepFrames(page, 1);
    const none = await probe(page);
    expect(none?.texturedVisible).toBe(false);
    expect(none?.boxVisible).toBe(false);

    // Line 3 → no meta.chrome, no textured "default": the drawn Graphics frame.
    await advanceUntilLine(page, "default frame");
    await stepFrames(page, 1);
    const drawn = await probe(page);
    expect(drawn?.texturedVisible).toBe(false);
    expect(drawn?.boxVisible).toBe(true);
  });

  test("a textured theme renders the speech bubble as a nine-slice", async ({
    page,
  }) => {
    await gotoFixture(page, "/dialogue-addon.html?theme=textured");
    await waitForClock(page);

    // The first box line uses the textured "default" style: the nine-slice host
    // shows, the drawn Graphics frame does not.
    await stepFrames(page, 4);
    const boxLine = await probe(page);
    expect(boxLine?.texturedVisible).toBe(true);
    expect(boxLine?.boxVisible).toBe(false);

    // Walk to the diegetic bubble line: its body is a nine-slice parented into
    // the bubble's Graphics (content-sized per line), so the bubble carries a
    // child sprite the plain Graphics bubble would not.
    await advanceUntilLine(page, "bubble");
    await stepFrames(page, 1);
    const bubble = await probe(page);
    expect(bubble?.bubbleVisible).toBe(true);
    expect(bubble?.bubbleTextured).toBe(true);
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

  test("meta.position moves the box frame (top above centre above bottom)", async ({
    page,
  }) => {
    await gotoFixture(page, "/dialogue-addon.html");
    await waitForClock(page);
    await playScript(page, "position");
    await stepFrames(page, 2);

    // Each line's nameplate Y tracks the box frame top, which meta.position moves.
    await advanceUntilLine(page, "bottom");
    await stepFrames(page, 1);
    const bottom = (await probe(page))!.nameY;

    await advanceUntilLine(page, "top");
    await stepFrames(page, 1);
    const top = (await probe(page))!.nameY;

    await advanceUntilLine(page, "centre");
    await stepFrames(page, 1);
    const centre = (await probe(page))!.nameY;

    // The frame (and its nameplate + body text, all one panel) moves with the hint.
    expect(top).toBeLessThan(centre);
    expect(centre).toBeLessThan(bottom);
  });

  test("an inline marker fires a reveal event and ticks fire per grapheme", async ({
    page,
  }) => {
    await gotoFixture(page, "/dialogue-addon.html");
    await waitForClock(page);
    await playScript(page, "marker");

    // Let the line "Knock[sfx=knock/] knock." type itself out over frames — ticks
    // fire per grapheme, and the [sfx=knock/] marker fires at its char offset →
    // DialogueRevealMarkerEvent. Step until both have happened (bounded).
    for (let i = 0; i < 80; i++) {
      const p = await probe(page);
      if (p && p.markerCount > 0 && p.tickCount > 0) break;
      await stepFrames(page, 2);
    }

    const p = await probe(page);
    expect(p?.tickCount).toBeGreaterThan(0); // per-grapheme typewriter ticks
    expect(p?.markerCount).toBeGreaterThan(0); // the inline marker fired
    // `[sfx=knock/]` → name "sfx" (the value "knock" rides in props), opaque to the addon.
    expect(p?.markerName).toBe("sfx");
  });

  test("a line-driven avatar reflows the box text", async ({ page }) => {
    await gotoFixture(page, "/dialogue-addon.html");
    await waitForClock(page);
    await playScript(page, "avatar");
    await stepFrames(page, 2);

    // First line: no portrait → the body text uses the full width.
    await advanceUntilLine(page, "full width");
    await stepFrames(page, 1);
    const noAvatar = (await probe(page))!;

    // Second line: meta.portrait → the avatar spawns and the body text shifts
    // right, reflowing around the reserved column.
    await advanceUntilLine(page, "reflows");
    await stepFrames(page, 1);
    const withAvatar = (await probe(page))!;

    expect(withAvatar.avatarPresent).toBe(true);
    expect(withAvatar.textX).toBeGreaterThan(noAvatar.textX);
  });
});

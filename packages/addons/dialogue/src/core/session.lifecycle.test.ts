/**
 * Design B lifecycle tests (D1–D5): the cutscene/pause/focus levers, the
 * visibility contract, and the new observation events — driving scenarios 1, 2,
 * and 4 at the headless session level. (Scenario 3's missing-actor anchoring is
 * in render/bubbleAnchor.test.ts; scenario 5's input focus is in
 * DialogueController.test.ts; the composite-forwarding matrix is in
 * composite/forwarding.test.ts; F28's variant restore is locked by the e2e.)
 */

import { describe, expect, it, vi } from "vitest";

import { DialogueSession } from "./session.js";
import { MemoryVariableStorage } from "./vars.js";
import type {
  AvatarChannel,
  ChoiceChannel,
  ChromeChannel,
  DialogueChannels,
  TextChannel,
} from "./session.js";
import type { Command, DialogueScript } from "./types.js";

/** Text channel that records visibility, present/clear counts, and the reveal
 *  seam. Reveal is manual (`finishReveal`) so a test drives the gating. */
class StubText implements TextChannel {
  presents = 0;
  clears = 0;
  visible = false;
  updates = 0;
  private revealing = false;
  private listener?: (() => void) | undefined;
  present(): void {
    this.presents++;
    this.revealing = true;
  }
  completeReveal(): void {
    this.finishReveal();
  }
  isRevealComplete(): boolean {
    return !this.revealing;
  }
  isRevealing(): boolean {
    return this.revealing;
  }
  setSpeedMultiplier(): void {}
  setVisible(v: boolean): void {
    this.visible = v;
  }
  update(): void {
    this.updates++;
  }
  clear(): void {
    this.clears++;
    this.revealing = false;
  }
  setRevealListener(l: (() => void) | undefined): void {
    this.listener = l;
  }
  finishReveal(): void {
    if (!this.revealing) return;
    this.revealing = false;
    this.listener?.();
  }
}

class StubChoices implements ChoiceChannel {
  visibles: boolean[] = [];
  presents = 0;
  onChoiceChosen?: (position: number) => void;
  present(): void {
    this.presents++;
  }
  highlight(): void {}
  setVisible(v: boolean): void {
    this.visibles.push(v);
  }
  clear(): void {}
}

class StubChrome implements ChromeChannel {
  visibles: boolean[] = [];
  continues: boolean[] = [];
  setNameplate(): void {}
  setContinueVisible(visible: boolean): void {
    this.continues.push(visible);
  }
  setVisible(v: boolean): void {
    this.visibles.push(v);
  }
  present(): void {}
  update(): void {}
}

class StubAvatar implements AvatarChannel {
  visibles: boolean[] = [];
  setSpeaker(): void {}
  setExpression(): void {}
  setSpeaking(): void {}
  setVisible(v: boolean): void {
    this.visibles.push(v);
  }
  update(): void {}
}

interface Harness {
  session: DialogueSession;
  text: StubText;
  choices: StubChoices;
  chrome: StubChrome;
  avatar: StubAvatar;
}

function makeHarness(opts?: ConstructorParameters<typeof DialogueSession>[1]): Harness {
  const text = new StubText();
  const choices = new StubChoices();
  const chrome = new StubChrome();
  const avatar = new StubAvatar();
  const channels: DialogueChannels = { text, choices, avatar, chrome };
  return { session: new DialogueSession(channels, opts), text, choices, chrome, avatar };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

/** A blocking command of `type` that stays in flight until the test calls
 *  `open()` — lets a test suspend the runner mid-command (e.g. an `afterReveal`
 *  batch awaited inside handleRevealComplete). */
function gatedCommand(type: string) {
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const onCommand = vi.fn((cmd: Command) => (cmd.type === type ? gate : undefined));
  return { onCommand, open, gate };
}

const twoLines: DialogueScript = {
  id: "two",
  start: "a",
  nodes: {
    a: {
      id: "a",
      steps: [
        { kind: "say", text: "one" },
        { kind: "say", text: "two" },
      ],
    },
  },
};

const autoScript: DialogueScript = {
  id: "auto",
  start: "a",
  nodes: {
    a: {
      id: "a",
      steps: [
        { kind: "say", text: "one", autoAdvanceMs: 100 },
        { kind: "say", text: "two" },
      ],
    },
  },
};

describe("DialogueSession — setHidden (scenario 1: cutscene takeover)", () => {
  it("hides every channel on setHidden(true) and restores them on setHidden(false)", () => {
    const h = makeHarness();
    h.session.play(twoLines);
    h.text.finishReveal();
    expect(h.text.visible).toBe(true); // shown while saying

    h.session.setHidden(true);
    expect(h.text.visible).toBe(false);
    expect(h.chrome.visibles.at(-1)).toBe(false);
    expect(h.avatar.visibles.at(-1)).toBe(false);

    h.session.setHidden(false);
    expect(h.text.visible).toBe(true);
    expect(h.chrome.visibles.at(-1)).toBe(true);
    expect(h.avatar.visibles.at(-1)).toBe(true);
  });

  it("hiding mid-line preserves reveal progress — the line is NOT re-presented", () => {
    const h = makeHarness();
    h.session.play(twoLines); // "one" still revealing
    expect(h.text.isRevealing()).toBe(true);
    const presentsBefore = h.text.presents;

    h.session.setHidden(true);
    h.session.setHidden(false);

    expect(h.text.presents).toBe(presentsBefore); // no clear/re-present round-trip
    expect(h.text.isRevealing()).toBe(true); // still mid-typewriter
  });

  it("setHidden persists across stop()/play() (it is a host lever, not conversation state)", () => {
    const h = makeHarness();
    h.session.setHidden(true);
    h.session.play(twoLines); // a fresh line is presented...
    expect(h.session.isHidden()).toBe(true);
    expect(h.text.visible).toBe(false); // ...but stays hidden until setHidden(false)
    expect(h.chrome.visibles.at(-1)).toBe(false);
  });

  it("setHidden does not end or freeze the conversation (state intact)", async () => {
    const h = makeHarness();
    h.session.play(twoLines);
    h.session.setHidden(true);
    expect(h.session.isActive()).toBe(true);
    h.text.finishReveal();
    h.session.advance(); // still drivable while hidden (input not frozen by hide)
    await flush();
    expect(h.text.presents).toBe(2); // advanced to "two"
  });
});

describe("DialogueSession — setPaused (scenario 2: world pause)", () => {
  it("freezes the update loop (reveal + auto-advance) and resumes intact", async () => {
    const h = makeHarness();
    h.session.play(autoScript);
    h.text.finishReveal();
    await flush(); // arm the 100ms auto-timer

    h.session.setPaused(true);
    const updatesBefore = h.text.updates;
    h.session.update(10_000); // frozen: no channel tick, auto-timer doesn't run
    await flush();
    expect(h.text.updates).toBe(updatesBefore); // channel.update NOT pumped
    expect(h.text.presents).toBe(1); // did not auto-advance to "two"

    h.session.setPaused(false);
    h.session.update(200); // resumes — the armed timer now fires
    await flush();
    expect(h.text.presents).toBe(2);
  });

  it("no-ops the input-agnostic API while paused (input is inert)", async () => {
    const h = makeHarness();
    h.session.play(twoLines);
    h.text.finishReveal();
    h.session.setPaused(true);
    h.session.advance(); // inert
    await flush();
    expect(h.text.presents).toBe(1); // did not advance to "two"
    h.session.setPaused(false);
    h.session.advance();
    await flush();
    expect(h.text.presents).toBe(2);
  });

  it("still accepts host-driven setVar while paused (pause freezes input, not writes)", () => {
    const h = makeHarness();
    const script: DialogueScript = {
      id: "vars",
      start: "a",
      declare: { gold: 0 },
      nodes: { a: { id: "a", steps: [{ kind: "say", text: "x" }] } },
    };
    const handle = h.session.play(script, { storage: new MemoryVariableStorage() });
    h.session.setPaused(true);
    handle.setVar("gold", 42);
    expect(handle.getVars().gold).toBe(42); // writes through despite the pause
  });

  it("does not bump the generation (no state reset)", () => {
    const h = makeHarness();
    h.session.play(twoLines);
    h.session.setPaused(true);
    h.session.setPaused(false);
    expect(h.session.isActive()).toBe(true);
    expect(h.text.presents).toBe(1); // same line, nothing reset/abandoned
  });

  it("a blocking afterReveal command resolving mid-pause arms the caret + timer and resumes intact", async () => {
    // The one edge the design notes call out (design-b-lifecycle-events.md
    // §"Pause + in-flight async"): a blocking command's promise keeps running
    // while paused, so its continuation (handleRevealComplete past its
    // afterReveal await) lands DURING the pause. It must arm the caret +
    // auto-timer and resume cleanly on unpause — and must NOT be "fixed" by
    // bumping the generation (which would abandon the line).
    const onRevealCompleted = vi.fn();
    const { onCommand, open, gate } = gatedCommand("wait");
    const h = makeHarness({ onRevealCompleted });
    const script: DialogueScript = {
      id: "blk",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [
            {
              kind: "say",
              text: "one",
              autoAdvanceMs: 100,
              commands: [{ type: "wait", at: "afterReveal", blocking: true }],
            },
            { kind: "say", text: "two" },
          ],
        },
      },
    };
    h.session.play(script, { fallbackCommand: onCommand });
    h.text.finishReveal(); // reveal done → afterReveal batch fires, awaits "wait"
    await flush();
    expect(h.chrome.continues.at(-1)).not.toBe(true); // continuation still suspended
    expect(onRevealCompleted).not.toHaveBeenCalled();

    h.session.setPaused(true); // pause while the continuation is in flight
    open(); // the blocking command resolves DURING the pause
    await gate;
    await flush();

    // The continuation ran mid-pause: caret armed, reveal hook fired, timer set —
    // and the conversation was NOT reset (same line still presented exactly once).
    expect(h.chrome.continues.at(-1)).toBe(true);
    expect(onRevealCompleted).toHaveBeenCalledTimes(1);
    expect(h.session.isActive()).toBe(true);
    expect(h.text.presents).toBe(1);

    // The armed auto-timer stays frozen until unpause...
    h.session.update(150);
    await flush();
    expect(h.text.presents).toBe(1);

    // ...then resumes cleanly — the armed timer fires the auto-advance.
    h.session.setPaused(false);
    h.session.update(150);
    await flush();
    expect(h.text.presents).toBe(2);
  });
});

describe("DialogueSession — observation events (scenario 4: audio/FX hooks)", () => {
  it("fires onRevealCompleted with the line's plain text when typing finishes", async () => {
    const onRevealCompleted = vi.fn();
    const h = makeHarness({ onRevealCompleted });
    const script: DialogueScript = {
      id: "rc",
      start: "a",
      speakers: { npc: { id: "npc", name: "Bee" } },
      nodes: { a: { id: "a", steps: [{ kind: "say", speaker: "npc", text: "[b]hi[/b] there" }] } },
    };
    h.session.play(script);
    expect(onRevealCompleted).not.toHaveBeenCalled(); // still revealing
    h.text.finishReveal();
    await flush();
    expect(onRevealCompleted).toHaveBeenCalledWith({ speaker: "Bee", text: "hi there" });
  });

  it("fires onSelectionChanged for keyboard nav AND pointer hover", () => {
    const onSelectionChanged = vi.fn();
    const h = makeHarness({ onSelectionChanged });
    const script: DialogueScript = {
      id: "sel",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [
            {
              kind: "choice",
              options: [
                { text: "left" },
                { text: "right" },
                { text: "down" },
              ],
            },
          ],
        },
      },
    };
    h.session.play(script);
    h.session.moveSelection(1); // keyboard → option 1
    expect(onSelectionChanged).toHaveBeenLastCalledWith({ index: 1, text: "right" });
    h.session.selectAt(2); // pointer hover → option 2
    expect(onSelectionChanged).toHaveBeenLastCalledWith({ index: 2, text: "down" });
  });

  it("does not fire onSelectionChanged when the cursor cannot actually move", () => {
    const onSelectionChanged = vi.fn();
    const h = makeHarness({ onSelectionChanged });
    const script: DialogueScript = {
      id: "one-opt",
      start: "a",
      nodes: { a: { id: "a", steps: [{ kind: "choice", options: [{ text: "ok" }] }] } },
    };
    h.session.play(script);
    h.session.moveSelection(1); // wraps 0 → 0 on a 1-option list: no real move
    h.session.moveSelection(-1);
    expect(onSelectionChanged).not.toHaveBeenCalled(); // no spurious "changed" event
  });

  it("fires onSkipUsed when the player skips a section", () => {
    const onSkipUsed = vi.fn();
    const h = makeHarness({ onSkipUsed });
    h.session.play(twoLines);
    h.session.skip();
    expect(onSkipUsed).toHaveBeenCalledWith({ scriptId: "two" });
  });

  it("fires onAutoAdvance when the auto-advance clock advances a line", async () => {
    const onAutoAdvance = vi.fn();
    const h = makeHarness({ onAutoAdvance });
    h.session.play(autoScript);
    h.text.finishReveal();
    await flush();
    h.session.update(150); // expire the 100ms timer
    await flush();
    expect(onAutoAdvance).toHaveBeenCalledWith({ scriptId: "auto" });
  });

  it("does not fire onSkipUsed when skip is a no-op (paused / not saying)", () => {
    const onSkipUsed = vi.fn();
    const h = makeHarness({ onSkipUsed });
    h.session.play(twoLines);
    h.session.setPaused(true);
    h.session.skip(); // paused → inert, no event
    expect(onSkipUsed).not.toHaveBeenCalled();
  });
});

describe("DialogueSession — reveal seam clobber-impossibility (D4)", () => {
  it("the Session's reveal handler can't be detached by a game (no public field)", async () => {
    // The TextChannel exposes only setRevealListener — there is no public
    // onRevealComplete field a game could assign to. The session-owned wiring
    // (caret-on-reveal) keeps working regardless of what a game pokes.
    const h = makeHarness();
    // A game's well-meant-but-wrong attempt to "hook reveal" by assigning a field
    // that no longer exists must not detach the session's handler.
    (h.text as unknown as Record<string, unknown>).onRevealComplete = () => {
      throw new Error("a clobbered handler must never run");
    };
    h.session.play(twoLines);
    h.text.finishReveal();
    await flush();
    // The session still gated correctly: it advanced reveal and is ready to move on.
    expect(h.session.isActive()).toBe(true);
    h.session.advance();
    await flush();
    expect(h.text.presents).toBe(2); // reveal seam intact → advance works
  });
});

import { describe, expect, it, vi } from "vitest";
import { createMockScene } from "@yagejs/core";

import { DialogueController } from "./DialogueController.js";
import {
  DialogueAutoAdvanceEvent,
  DialogueRevealCompletedEvent,
  DialogueSelectionChangedEvent,
  DialogueSkipUsedEvent,
} from "./events.js";
import type {
  ChoicePresenter,
  ChromePresenter,
  TextPresenter,
} from "./chrome/DialogueUiAdapter.js";
import type { DialogueScript, DialogueSession } from "./core/index.js";
import type { InputBinding } from "./input/index.js";

class StubChrome implements ChromePresenter {
  mount(): void {}
  dispose(): void {}
  setNameplate(): void {}
  setContinueVisible(): void {}
  setVisible(): void {}
  update(): void {}
}

class StubText implements TextPresenter {
  mount(): void {}
  dispose(): void {}
  present(): void {}
  completeReveal(): void {}
  isRevealComplete(): boolean {
    return true;
  }
  isRevealing(): boolean {
    return false;
  }
  setSpeedMultiplier(): void {}
  setVisible(): void {}
  setRevealListener(): void {}
  update(): void {}
  clear(): void {}
}

class StubChoices implements ChoicePresenter {
  onChoiceChosen?: (position: number) => void;
  mount(): void {}
  dispose(): void {}
  present(): void {}
  highlight(): void {}
  setVisible(): void {}
  clear(): void {}
}

/** A text presenter whose typewriter reveal the test drives by hand (via
 *  `finish()`), so the controller's onRevealCompleted → event forwarding is
 *  reachable without a real renderer. */
class DrivableText implements TextPresenter {
  private listener: (() => void) | undefined;
  private revealing = false;
  mount(): void {}
  dispose(): void {}
  present(): void {
    this.revealing = true;
  }
  completeReveal(): void {
    this.finish();
  }
  isRevealComplete(): boolean {
    return !this.revealing;
  }
  isRevealing(): boolean {
    return this.revealing;
  }
  setSpeedMultiplier(): void {}
  setVisible(): void {}
  setRevealListener(l: (() => void) | undefined): void {
    this.listener = l;
  }
  update(): void {}
  clear(): void {
    this.revealing = false;
  }
  finish(): void {
    if (!this.revealing) return;
    this.revealing = false;
    this.listener?.();
  }
}

const noopBinding: InputBinding = { bind() {}, poll() {} };

/** A binding that counts poll() calls, to prove the focus/pause gating. */
class RecordingBinding implements InputBinding {
  polls = 0;
  bind(): void {}
  poll(): void {
    this.polls++;
  }
}

/** Captures the session the controller binds, so a test can drive the
 *  input-agnostic API (moveSelection / skip) exactly as a real binding would. */
class CapturingBinding implements InputBinding {
  session: DialogueSession | undefined;
  bind(_input: unknown, session: DialogueSession): void {
    this.session = session;
  }
  poll(): void {}
}

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

const SCRIPT: DialogueScript = {
  id: "guard",
  start: "a",
  nodes: { a: { id: "a", steps: [{ kind: "say", text: "hi" }] } },
};

function makeController(input: InputBinding = noopBinding): DialogueController {
  return new DialogueController({
    chrome: new StubChrome(),
    text: new StubText(),
    choices: new StubChoices(),
    input,
  });
}

describe("DialogueController — play() lifecycle guards (F49)", () => {
  it("play() before the component is added throws a clear error", () => {
    const controller = makeController();
    expect(() => controller.play(SCRIPT)).toThrow(
      /before the component was added/,
    );
  });

  it("play() after the component is removed refuses instead of running into disposed presenters", () => {
    const { scene } = createMockScene();
    const host = scene.spawn("dialogue-host");
    const controller = host.add(makeController());

    controller.play(SCRIPT);
    expect(controller.isActive()).toBe(true);

    host.remove(DialogueController); // runs onRemove + onDestroy

    controller.play(SCRIPT); // a stale ref (e.g. an interact closure)
    expect(controller.isActive()).toBe(false);
  });
});

describe("DialogueController — input focus + pause gating", () => {
  it("setInputEnabled gates the binding poll but keeps the session alive", () => {
    const { scene } = createMockScene();
    const binding = new RecordingBinding();
    const controller = scene.spawn("dlg").add(makeController(binding));
    controller.play(SCRIPT);

    controller.update(16);
    expect(binding.polls).toBe(1); // focused → polled

    controller.setInputEnabled(false);
    controller.update(16);
    expect(binding.polls).toBe(1); // unfocused → NOT polled (no input consumed)
    expect(controller.isActive()).toBe(true); // ...but the conversation stays alive

    controller.setInputEnabled(true);
    controller.update(16);
    expect(binding.polls).toBe(2); // refocused → polled again
  });

  it("two conversations, one interactive: only the focused binding polls", () => {
    const { scene } = createMockScene();
    const aBinding = new RecordingBinding();
    const bBinding = new RecordingBinding();
    const a = scene.spawn("a").add(makeController(aBinding));
    const b = scene.spawn("b").add(makeController(bBinding));
    a.play(SCRIPT);
    b.play(SCRIPT);

    // The game's one-liner: focus A, leave B ambient.
    a.setInputEnabled(true);
    b.setInputEnabled(false);
    a.update(16);
    b.update(16);

    expect(aBinding.polls).toBe(1); // Space reaches A
    expect(bBinding.polls).toBe(0); // ...but not ambient B
    expect(b.isActive()).toBe(true); // B is still running, just not interactive
  });

  it("setPaused gates the binding poll too (a frozen conversation consumes no input)", () => {
    const { scene } = createMockScene();
    const binding = new RecordingBinding();
    const controller = scene.spawn("dlg").add(makeController(binding));
    controller.play(SCRIPT);

    controller.setPaused(true);
    controller.update(16);
    expect(binding.polls).toBe(0); // paused → not polled

    controller.setPaused(false);
    controller.update(16);
    expect(binding.polls).toBe(1); // resumed → polled
  });
});

describe("DialogueController — observation events forwarded entity→scene", () => {
  // The session's four new observation callbacks have only ONE consumer: the
  // controller, which turns each into an entity→scene event (no controller-level
  // callback opts). These lock that forwarding seam — the path games subscribe to.
  function mountForEvents() {
    const { scene } = createMockScene();
    const host = scene.spawn("dlg");
    const text = new DrivableText();
    const binding = new CapturingBinding();
    const controller = host.add(
      new DialogueController({
        chrome: new StubChrome(),
        text,
        choices: new StubChoices(),
        input: binding,
      }),
    );
    const session = binding.session; // captured during onAdd → bind()
    if (!session) throw new Error("controller did not bind the session on add");
    return { host, text, controller, session };
  }

  const sayScript: DialogueScript = {
    id: "say",
    start: "a",
    speakers: { npc: { id: "npc", name: "Bee" } },
    nodes: { a: { id: "a", steps: [{ kind: "say", speaker: "npc", text: "hi" }] } },
  };

  it("forwards onRevealCompleted → DialogueRevealCompletedEvent with the line text", async () => {
    const { host, text, controller } = mountForEvents();
    const seen = vi.fn();
    host.on(DialogueRevealCompletedEvent, seen);
    controller.play(sayScript);
    text.finish(); // typewriter done → reveal-completed hook
    await flush();
    expect(seen).toHaveBeenCalledWith({ speaker: "Bee", text: "hi" });
  });

  it("forwards onSelectionChanged → DialogueSelectionChangedEvent on cursor move", () => {
    const { host, controller, session } = mountForEvents();
    const seen = vi.fn();
    host.on(DialogueSelectionChangedEvent, seen);
    controller.play({
      id: "choose",
      start: "a",
      nodes: {
        a: {
          id: "a",
          steps: [{ kind: "choice", options: [{ text: "left" }, { text: "right" }] }],
        },
      },
    });
    session.moveSelection(1); // keyboard nav → option 1
    expect(seen).toHaveBeenCalledWith({ index: 1, text: "right" });
  });

  it("forwards onSkipUsed → DialogueSkipUsedEvent", () => {
    const { host, controller, session } = mountForEvents();
    const seen = vi.fn();
    host.on(DialogueSkipUsedEvent, seen);
    controller.play(sayScript);
    session.skip();
    expect(seen).toHaveBeenCalledWith({ scriptId: "say" });
  });

  it("forwards onAutoAdvance → DialogueAutoAdvanceEvent when the clock advances a line", async () => {
    const { host, text, controller, session } = mountForEvents();
    const seen = vi.fn();
    host.on(DialogueAutoAdvanceEvent, seen);
    controller.play({
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
    });
    text.finish(); // arms the 100ms auto-timer
    await flush();
    session.update(150); // expire it → auto-advance
    await flush();
    expect(seen).toHaveBeenCalledWith({ scriptId: "auto" });
  });
});

describe("DialogueController — levers set before onAdd reach the session", () => {
  // setPaused/setHidden forward to the session, which doesn't exist until onAdd.
  // A host that configures the controller BEFORE adding it must not get a
  // half-applied state (paused input but a still-ticking session); onAdd
  // re-syncs the freshly-created session to the controller's mirrors.
  function configureThenAdd(configure: (c: DialogueController) => void): DialogueSession {
    const { scene } = createMockScene();
    const binding = new CapturingBinding();
    const controller = new DialogueController({
      chrome: new StubChrome(),
      text: new StubText(),
      choices: new StubChoices(),
      input: binding,
    });
    configure(controller); // lever set while the session does NOT yet exist
    scene.spawn("dlg").add(controller); // onAdd creates the session + re-syncs
    const session = binding.session;
    if (!session) throw new Error("controller did not bind a session on add");
    return session;
  }

  it("applies a pre-add setPaused(true) to the session", () => {
    expect(configureThenAdd((c) => c.setPaused(true)).isPaused()).toBe(true);
  });

  it("applies a pre-add setHidden(true) to the session", () => {
    expect(configureThenAdd((c) => c.setHidden(true)).isHidden()).toBe(true);
  });

  it("leaves an unconfigured controller's session at its defaults", () => {
    const session = configureThenAdd(() => {});
    expect(session.isPaused()).toBe(false);
    expect(session.isHidden()).toBe(false);
  });
});

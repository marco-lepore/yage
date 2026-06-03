import { describe, expect, it, vi } from "vitest";
import type { InputManager } from "@yagejs/input";
import type { DialogueSession } from "../core/session.js";
import {
  FULL_ACTIONS,
  KeyboardInputBinding,
  PointerInputBinding,
  type TermTarget,
} from "./InputBinding.js";

/** Minimal InputManager stub — only the methods the bindings touch. */
class FakeInput {
  readonly pressed = new Set<string>();
  readonly hold = new Map<string, number>();
  readonly justPressed = new Set<string>();
  screen = { x: 0, y: 0 };
  world = { x: 0, y: 0 };
  private downCb: ((i: { button: number }) => void) | undefined;

  isPressed(a: string): boolean {
    return this.pressed.has(a);
  }
  isJustPressed(a: string): boolean {
    return this.justPressed.has(a);
  }
  getHoldDuration(a: string): number {
    return this.hold.get(a) ?? 0;
  }
  isHeldFor(a: string, t: number): boolean {
    return this.getHoldDuration(a) >= t;
  }
  getPointerPosition(): { x: number; y: number } {
    return this.world;
  }
  getPointerScreenPosition(): { x: number; y: number } {
    return this.screen;
  }
  onPointerDown(cb: (i: { button: number }) => void): () => void {
    this.downCb = cb;
    return () => (this.downCb = undefined);
  }
  /** Simulate a primary pointer press the binding latches in poll(). */
  click(button = 0): void {
    this.downCb?.({ button });
  }
  asManager(): InputManager {
    return this as unknown as InputManager;
  }
}

/** Minimal DialogueSession stub recording what the binding drives. */
class FakeSession {
  advanced = 0;
  skipped = 0;
  choosing = false;
  advance(): void {
    this.advanced++;
  }
  skip(): void {
    this.skipped++;
  }
  setFastForward(): void {}
  moveSelection(): void {}
  isChoosing(): boolean {
    return this.choosing;
  }
  selectAt(): void {}
  confirm(): void {}
  asSession(): DialogueSession {
    return this as unknown as DialogueSession;
  }
}

describe("KeyboardInputBinding — hold-to-skip", () => {
  it("fires skip once held past the threshold, then re-arms after release", () => {
    const input = new FakeInput();
    const session = new FakeSession();
    const b = new KeyboardInputBinding(FULL_ACTIONS, 600);
    b.bind(input.asManager(), session.asSession());

    input.pressed.add("skip");
    input.hold.set("skip", 100);
    b.poll();
    expect(session.skipped).toBe(0); // below threshold

    input.hold.set("skip", 600);
    b.poll();
    expect(session.skipped).toBe(1); // crossed threshold
    b.poll();
    expect(session.skipped).toBe(1); // latched — no refire while still held

    input.pressed.delete("skip");
    input.hold.set("skip", 0);
    b.poll(); // released → re-arm
    input.pressed.add("skip");
    input.hold.set("skip", 600);
    b.poll();
    expect(session.skipped).toBe(2);
  });

  it("with skipHoldMs 0, skip fires on press (no hold required)", () => {
    const input = new FakeInput();
    const session = new FakeSession();
    const b = new KeyboardInputBinding(FULL_ACTIONS, 0);
    b.bind(input.asManager(), session.asSession());
    input.pressed.add("skip");
    input.hold.set("skip", 0);
    b.poll();
    expect(session.skipped).toBe(1);
  });
});

describe("PointerInputBinding — single term seam", () => {
  it("a tap on a term activates it and does NOT advance the line", () => {
    const input = new FakeInput();
    const session = new FakeSession();
    const b = new PointerInputBinding();
    b.bind(input.asManager(), session.asSession());

    const activations: { id: string; kind: string }[] = [];
    const setHoveredTerm = vi.fn();
    const term: TermTarget = {
      termAtPoint: () => "mana",
      pointerSpace: "screen",
      setHoveredTerm,
    };
    b.setTermSink(term, (e) => activations.push({ id: e.id, kind: e.kind }));

    input.click(0);
    b.poll();

    expect(session.advanced).toBe(0); // the tap is consumed by the term
    expect(activations.some((a) => a.kind === "tap" && a.id === "mana")).toBe(
      true,
    );
    expect(setHoveredTerm).toHaveBeenCalledWith("mana"); // hover highlight wired
  });

  it("a tap off any term advances the line", () => {
    const input = new FakeInput();
    const session = new FakeSession();
    const b = new PointerInputBinding();
    b.bind(input.asManager(), session.asSession());
    b.setTermSink(
      { termAtPoint: () => undefined, pointerSpace: "screen" },
      () => {},
    );

    input.click(0);
    b.poll();
    expect(session.advanced).toBe(1);
  });

  it("hover fires once per entry and clears the highlight on exit", () => {
    const input = new FakeInput();
    const session = new FakeSession();
    const b = new PointerInputBinding();
    b.bind(input.asManager(), session.asSession());

    let under: string | undefined = "mana";
    const setHoveredTerm = vi.fn();
    const hovers: string[] = [];
    b.setTermSink(
      { termAtPoint: () => under, pointerSpace: "screen", setHoveredTerm },
      (e) => {
        if (e.kind === "hover") hovers.push(e.id);
      },
    );

    b.poll(); // enter "mana"
    b.poll(); // still on "mana" — no refire
    under = undefined;
    b.poll(); // leave

    expect(hovers).toEqual(["mana"]);
    expect(setHoveredTerm).toHaveBeenLastCalledWith(undefined);
  });
});

import { describe, expect, it } from "vitest";
import type { InputManager } from "@yagejs/input";
import type { DialogueSession } from "../core/session.js";
import type { InputBinding } from "./InputBinding.js";
import {
  CompositeInputBinding,
  DEFAULT_ACTIONS,
  FULL_ACTIONS,
  KeyboardInputBinding,
  PointerInputBinding,
  fullControls,
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
    const b = new KeyboardInputBinding(FULL_ACTIONS, 0.6);
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

  it("with skipHold 0, skip fires on press (no hold required)", () => {
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

describe("PointerInputBinding", () => {
  it("a tap during a line advances it", () => {
    const input = new FakeInput();
    const session = new FakeSession();
    const b = new PointerInputBinding();
    b.bind(input.asManager(), session.asSession());

    input.click(0);
    b.poll();
    expect(session.advanced).toBe(1);
  });

  it("re-binding releases the previous pointer subscription (no leak)", () => {
    const first = new FakeInput();
    const second = new FakeInput();
    const session = new FakeSession();
    const b = new PointerInputBinding();
    b.bind(first.asManager(), session.asSession());
    b.bind(second.asManager(), session.asSession());

    first.click(0); // a leaked first-input subscription would latch this click
    b.poll();
    expect(session.advanced).toBe(0);

    second.click(0);
    b.poll();
    expect(session.advanced).toBe(1);
  });

});

describe("action-name introspection", () => {
  it("KeyboardInputBinding.actionNames() returns its configured names, de-duplicated", () => {
    const b = new KeyboardInputBinding(DEFAULT_ACTIONS);
    // DEFAULT_ACTIONS: advance=interact, speed=attack, up=move-up, down=move-down.
    expect([...b.actionNames()].sort()).toEqual(
      ["attack", "interact", "move-down", "move-up"].sort(),
    );
  });

  it("KeyboardInputBinding.actionNames() includes the optional `skip` slot", () => {
    const b = new KeyboardInputBinding(FULL_ACTIONS);
    expect(b.actionNames()).toContain("skip");
  });

  it("KeyboardInputBinding.actionNames() de-duplicates a name shared across slots", () => {
    const b = new KeyboardInputBinding({
      advance: ["ok"],
      speed: ["ok"],
      up: ["u"],
      down: ["d"],
    });
    expect([...b.actionNames()].sort()).toEqual(["d", "ok", "u"]);
  });

  it("CompositeInputBinding aggregates its keyboard child's names", () => {
    const composite = new CompositeInputBinding([
      new KeyboardInputBinding(DEFAULT_ACTIONS),
      new PointerInputBinding(), // contributes no action names
    ]);
    expect([...composite.actionNames()].sort()).toEqual(
      ["attack", "interact", "move-down", "move-up"].sort(),
    );
  });

  it("PointerInputBinding has no actionNames (pure pointer, polls no action map)", () => {
    const binding: InputBinding = new PointerInputBinding();
    expect(binding.actionNames).toBeUndefined();
  });

  it("fullControls() surfaces the keyboard action names through the composite", () => {
    const binding = fullControls();
    expect(binding.actionNames?.()).toContain("interact");
    expect(binding.actionNames?.()).toContain("move-up");
  });
});

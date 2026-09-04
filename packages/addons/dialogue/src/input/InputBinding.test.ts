import { describe, expect, it } from "vitest";
import type {
  InputManager,
  PointerPressInfo,
  PointerPressOptions,
} from "@yagejs/input";
import type { DialogueSession } from "../core/session.js";
import type { InputBinding } from "./InputBinding.js";
import {
  CompositeInputBinding,
  DEFAULT_DIALOGUE_ACTIONS,
  FULL_DIALOGUE_ACTIONS,
  KeyboardInputBinding,
  PointerInputBinding,
  dialogueControls,
} from "./InputBinding.js";

/** Minimal InputManager stub — only the methods the bindings touch. */
class FakeInput {
  readonly pressed = new Set<string>();
  readonly hold = new Map<string, number>();
  readonly justPressed = new Set<string>();
  screen = { x: 0, y: 0 };
  world = { x: 0, y: 0 };
  readonly consumed = new Set<number>();
  private readonly presses: Array<{ button: number; id: number }> = [];

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
  getPointerPresses(
    options: PointerPressOptions = {},
  ): readonly PointerPressInfo[] {
    return this.presses
      .filter(({ button, id }) => {
        if (options.button !== undefined && button !== options.button) {
          return false;
        }
        const consumed = this.consumed.has(id);
        return options.consumed === "include"
          ? true
          : options.consumed === "only"
            ? consumed
            : !consumed;
      })
      .map(
        ({ button, id }) =>
          ({
            id,
            generation: 1,
            screenPos: this.screen,
            worldPos: this.world,
            type: "mouse",
            isPrimary: true,
            buttons: new Set([button]),
            isDown: true,
            button,
            consumed: this.consumed.has(id),
          }) as unknown as PointerPressInfo,
      );
  }
  /** Simulate a primary pointer press retained for the current frame. */
  click(button = 0, id = 1): void {
    this.presses.push({ button, id });
  }
  clearFrame(): void {
    this.presses.length = 0;
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
  fastForward: boolean[] = [];
  advance(): void {
    this.advanced++;
  }
  skip(): void {
    this.skipped++;
  }
  setFastForward(on: boolean): void {
    this.fastForward.push(on);
  }
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
    const b = new KeyboardInputBinding(FULL_DIALOGUE_ACTIONS, 0.6);
    b.bind(input.asManager(), session.asSession());

    input.pressed.add("skip");
    input.hold.set("skip", 0.1);
    b.poll();
    expect(session.skipped).toBe(0); // below threshold

    input.hold.set("skip", 0.6);
    b.poll();
    expect(session.skipped).toBe(1); // crossed threshold
    b.poll();
    expect(session.skipped).toBe(1); // latched — no refire while still held

    input.pressed.delete("skip");
    input.hold.set("skip", 0);
    b.poll(); // released → re-arm
    input.pressed.add("skip");
    input.hold.set("skip", 0.6);
    b.poll();
    expect(session.skipped).toBe(2);
  });

  it("with skipHold 0, skip fires on press (no hold required)", () => {
    const input = new FakeInput();
    const session = new FakeSession();
    const b = new KeyboardInputBinding(FULL_DIALOGUE_ACTIONS, 0);
    b.bind(input.asManager(), session.asSession());
    input.pressed.add("skip");
    input.hold.set("skip", 0);
    b.poll();
    expect(session.skipped).toBe(1);
  });

  it("re-binding releases fast-forward on the previous session", () => {
    const firstInput = new FakeInput();
    const secondInput = new FakeInput();
    const firstSession = new FakeSession();
    const secondSession = new FakeSession();
    const binding = new KeyboardInputBinding();
    binding.bind(firstInput.asManager(), firstSession.asSession());
    firstInput.pressed.add("attack");
    binding.poll();

    binding.bind(secondInput.asManager(), secondSession.asSession());

    expect(firstSession.fastForward).toEqual([true, false]);
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

  it("a tap on a consumed pointer does not advance", () => {
    const input = new FakeInput();
    const session = new FakeSession();
    const b = new PointerInputBinding();
    b.bind(input.asManager(), session.asSession());

    input.consumed.add(3); // e.g. a touch overlay claimed this pointer
    input.click(0, 3);
    b.poll();
    expect(session.advanced).toBe(0);

    input.click(0, 4); // an unclaimed pointer still advances
    b.poll();
    expect(session.advanced).toBe(1);
  });

  it("a consumed tap does not shadow an unclaimed tap in the same frame", () => {
    const input = new FakeInput();
    const session = new FakeSession();
    const b = new PointerInputBinding();
    b.bind(input.asManager(), session.asSession());

    input.consumed.add(3);
    input.click(0, 4); // unclaimed tap...
    input.click(0, 3); // ...then a consumed overlay tap before the next poll
    b.poll();
    expect(session.advanced).toBe(1);
  });

  it("re-binding reads presses from the current input only", () => {
    const first = new FakeInput();
    const second = new FakeInput();
    const session = new FakeSession();
    const b = new PointerInputBinding();
    b.bind(first.asManager(), session.asSession());
    b.bind(second.asManager(), session.asSession());

    first.click(0);
    b.poll();
    expect(session.advanced).toBe(0);

    second.click(0);
    b.poll();
    expect(session.advanced).toBe(1);
  });
});

describe("action-name introspection", () => {
  it("KeyboardInputBinding.actionNames() returns its configured names, de-duplicated", () => {
    const b = new KeyboardInputBinding(DEFAULT_DIALOGUE_ACTIONS);
    // DEFAULT_DIALOGUE_ACTIONS: advance=interact, speed=attack, up=move-up, down=move-down.
    expect([...b.actionNames()].sort()).toEqual(
      ["attack", "interact", "move-down", "move-up"].sort(),
    );
  });

  it("KeyboardInputBinding.actionNames() includes the optional `skip` slot", () => {
    const b = new KeyboardInputBinding(FULL_DIALOGUE_ACTIONS);
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
      new KeyboardInputBinding(DEFAULT_DIALOGUE_ACTIONS),
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

  it("dialogueControls() surfaces the keyboard action names through the composite", () => {
    const binding = dialogueControls();
    expect(binding.actionNames?.()).toContain("interact");
    expect(binding.actionNames?.()).toContain("move-up");
  });
});

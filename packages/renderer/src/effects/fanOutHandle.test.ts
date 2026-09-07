import { describe, it, expect, vi } from "vitest";
import type { Process } from "@yagejs/core";
import type { EffectHandle } from "./EffectHandle.js";
import { fanOutHandle } from "./fanOutHandle.js";

interface TestHandle extends EffectHandle {
  trigger(x: number): string;
  readonly label: string;
}

function makeProcess(id: string): Process {
  return { id } as unknown as Process;
}

function makeHandle(label: string, enabled = true): TestHandle {
  const handle = {
    remove: vi.fn(),
    setEnabled: vi.fn(),
    enabled,
    setIntensity: vi.fn(),
    fadeIn: vi.fn(() => makeProcess(`${label}:in`)),
    fadeOut: vi.fn(() => makeProcess(`${label}:out`)),
    run: vi.fn((p: Process) => p),
    trigger: vi.fn((x: number) => `${label}:${x}`),
    label,
  };
  return handle as unknown as TestHandle;
}

describe("fanOutHandle", () => {
  it("fans every EffectHandle method out to all handles", () => {
    const a = makeHandle("a");
    const b = makeHandle("b");
    const composite = fanOutHandle([a, b]);

    composite.remove();
    composite.setEnabled(false);
    composite.setIntensity(0.25);
    composite.fadeIn(1);
    composite.fadeOut(2);
    const process = makeProcess("p");
    composite.run(process);

    for (const handle of [a, b]) {
      expect(handle.remove).toHaveBeenCalledTimes(1);
      expect(handle.setEnabled).toHaveBeenCalledWith(false);
      expect(handle.setIntensity).toHaveBeenCalledWith(0.25);
      expect(handle.fadeIn).toHaveBeenCalledWith(1);
      expect(handle.fadeOut).toHaveBeenCalledWith(2);
      expect(handle.run).toHaveBeenCalledWith(process);
    }
  });

  it("returns the first handle's Process from fadeIn / fadeOut", () => {
    const composite = fanOutHandle([makeHandle("a"), makeHandle("b")]);

    expect(composite.fadeIn(1)).toEqual({ id: "a:in" });
    expect(composite.fadeOut(1)).toEqual({ id: "a:out" });
  });

  it("fans extras out and returns the first result", () => {
    const a = makeHandle("a");
    const b = makeHandle("b");
    const composite = fanOutHandle([a, b]);

    expect(composite.trigger(7)).toBe("a:7");
    expect(a.trigger).toHaveBeenCalledWith(7);
    expect(b.trigger).toHaveBeenCalledWith(7);
  });

  it("reads `enabled` and non-function extras from the first handle", () => {
    const a = makeHandle("a", false);
    const composite = fanOutHandle([a, makeHandle("b", true)]);

    expect(composite.enabled).toBe(false);
    expect(composite.label).toBe("a");

    (a as { enabled: boolean }).enabled = true;
    expect(composite.enabled).toBe(true);
  });

  it("throws when given no handles", () => {
    expect(() => fanOutHandle([])).toThrow(/at least one handle/);
  });
});

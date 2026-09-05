import { describe, expect, it, vi } from "vitest";
import { DebugClock } from "./DebugClock.js";

function createClock(options?: { frozen?: boolean }) {
  const host = {
    fixedTimestep: 20,
    advance: vi.fn(),
    freeze: vi.fn(),
    thaw: vi.fn(),
  };
  const clock = new DebugClock(host);
  if (options?.frozen) {
    clock.freeze();
    // Reset the host mocks so tests start with a clean call-count slate
    // regardless of how the clock was put into the frozen state.
    host.freeze.mockClear();
    host.thaw.mockClear();
  }
  return { clock, host };
}

describe("DebugClock", () => {
  it("defaults to auto mode", () => {
    const { clock } = createClock();
    expect(clock.isFrozen).toBe(false);
  });

  it("freeze freezes and freezes the host", () => {
    const { clock, host } = createClock();
    clock.freeze();
    expect(clock.isFrozen).toBe(true);
    expect(host.freeze).toHaveBeenCalledOnce();
  });

  it("thaw thaws the host", () => {
    const { clock, host } = createClock({ frozen: true });
    host.thaw.mockClear();
    clock.thaw();
    expect(clock.isFrozen).toBe(false);
    expect(host.thaw).toHaveBeenCalledOnce();
  });

  it("freeze is idempotent when already frozen", () => {
    const { clock, host } = createClock({ frozen: true });
    host.freeze.mockClear();
    clock.freeze();
    expect(host.freeze).not.toHaveBeenCalled();
  });

  it("thaw is idempotent when already auto", () => {
    const { clock, host } = createClock();
    clock.thaw();
    expect(host.thaw).not.toHaveBeenCalled();
  });

  it("step throws when not frozen", () => {
    const { clock } = createClock();
    expect(() => clock.step()).toThrow("not frozen");
  });

  it("step uses fixedTimestep as default dt", () => {
    const { clock, host } = createClock({ frozen: true });
    clock.step();
    expect(host.advance).toHaveBeenCalledWith(20);
  });

  it("step passes custom dt", () => {
    const { clock, host } = createClock({ frozen: true });
    clock.step(10);
    expect(host.advance).toHaveBeenCalledWith(10);
  });

  it.each([0, -1, NaN, Infinity])(
    "step rejects invalid explicit dt: %p",
    (dt) => {
      const { clock, host } = createClock({ frozen: true });
      expect(() => clock.step(dt)).toThrow("positive number");
      expect(host.advance).not.toHaveBeenCalled();
    },
  );

  it("propagates an advance failure", () => {
    const { clock, host } = createClock({ frozen: true });
    host.advance.mockImplementationOnce(() => {
      throw new Error("listener boom");
    });
    expect(() => clock.step()).toThrow("listener boom");
    expect(host.advance).toHaveBeenCalledOnce();
  });

  it("stepFrames advances the host n times", () => {
    const { clock, host } = createClock({ frozen: true });
    clock.stepFrames(3);
    expect(host.advance).toHaveBeenCalledTimes(3);
    expect(host.advance).toHaveBeenNthCalledWith(1, 20);
    expect(host.advance).toHaveBeenNthCalledWith(2, 20);
    expect(host.advance).toHaveBeenNthCalledWith(3, 20);
  });

  it("stepFrames with custom dt passes it to each step", () => {
    const { clock, host } = createClock({ frozen: true });
    clock.stepFrames(2, 8);
    expect(host.advance).toHaveBeenNthCalledWith(1, 8);
    expect(host.advance).toHaveBeenNthCalledWith(2, 8);
  });

  it("stepFrames rejects non-integer count", () => {
    const { clock } = createClock({ frozen: true });
    expect(() => clock.stepFrames(1.5)).toThrow("non-negative integer");
  });

  it("stepFrames rejects negative count", () => {
    const { clock } = createClock({ frozen: true });
    expect(() => clock.stepFrames(-1)).toThrow("non-negative integer");
  });
});

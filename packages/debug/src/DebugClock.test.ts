import { describe, expect, it, vi } from "vitest";
import { DebugClock } from "./DebugClock.js";

function createClock(options?: { frozen?: boolean }) {
  const gameLoop = { tick: vi.fn(), fixedTimestep: 20 };
  const stopTicker = vi.fn();
  const startTicker = vi.fn();
  const render = vi.fn();
  const clock = new DebugClock(gameLoop, stopTicker, startTicker, render);
  if (options?.frozen) clock.setFrozen(true);
  return { clock, gameLoop, stopTicker, startTicker, render };
}

describe("DebugClock", () => {
  it("defaults to auto mode", () => {
    const { clock } = createClock();
    expect(clock.isFrozen).toBe(false);
  });

  it("stopAuto freezes and stops the ticker", () => {
    const { clock, stopTicker } = createClock();
    clock.stopAuto();
    expect(clock.isFrozen).toBe(true);
    expect(stopTicker).toHaveBeenCalledOnce();
  });

  it("startAuto thaws and starts the ticker", () => {
    const { clock, startTicker } = createClock({ frozen: true });
    clock.startAuto();
    expect(clock.isFrozen).toBe(false);
    expect(startTicker).toHaveBeenCalledOnce();
  });

  it("stopAuto is idempotent when already frozen", () => {
    const { clock, stopTicker } = createClock({ frozen: true });
    stopTicker.mockClear();
    clock.stopAuto();
    expect(stopTicker).not.toHaveBeenCalled();
  });

  it("startAuto is idempotent when already auto", () => {
    const { clock, startTicker } = createClock();
    clock.startAuto();
    expect(startTicker).not.toHaveBeenCalled();
  });

  it("step throws when not frozen", () => {
    const { clock } = createClock();
    expect(() => clock.step()).toThrow("not frozen");
  });

  it("step uses fixedTimestep as default dt", () => {
    const { clock, gameLoop, render } = createClock({ frozen: true });
    clock.step();
    expect(gameLoop.tick).toHaveBeenCalledWith(20);
    expect(render).toHaveBeenCalledOnce();
  });

  it("step passes custom dt", () => {
    const { clock, gameLoop } = createClock({ frozen: true });
    clock.step(10);
    expect(gameLoop.tick).toHaveBeenCalledWith(10);
  });

  it("tracks frame count while frozen", () => {
    const { clock } = createClock({ frozen: true });
    expect(clock.getFrame()).toBe(0);
    clock.step();
    clock.step();
    expect(clock.getFrame()).toBe(2);
  });

  it("stepFrames calls tick and render n times", () => {
    const { clock, gameLoop, render } = createClock({ frozen: true });
    clock.stepFrames(3);
    expect(gameLoop.tick).toHaveBeenCalledTimes(3);
    expect(render).toHaveBeenCalledTimes(3);
    expect(gameLoop.tick).toHaveBeenNthCalledWith(1, 20);
    expect(gameLoop.tick).toHaveBeenNthCalledWith(2, 20);
    expect(gameLoop.tick).toHaveBeenNthCalledWith(3, 20);
  });

  it("stepFrames with custom dt passes it to each step", () => {
    const { clock, gameLoop } = createClock({ frozen: true });
    clock.stepFrames(2, 8);
    expect(gameLoop.tick).toHaveBeenNthCalledWith(1, 8);
    expect(gameLoop.tick).toHaveBeenNthCalledWith(2, 8);
  });

  it("stepFrames rejects non-integer count", () => {
    const { clock } = createClock({ frozen: true });
    expect(() => clock.stepFrames(1.5)).toThrow("non-negative integer");
  });

  it("stepFrames rejects negative count", () => {
    const { clock } = createClock({ frozen: true });
    expect(() => clock.stepFrames(-1)).toThrow("non-negative integer");
  });

  it("setFrozen round-trips correctly", () => {
    const { clock, stopTicker, startTicker } = createClock();
    clock.setFrozen(true);
    expect(clock.isFrozen).toBe(true);
    expect(stopTicker).toHaveBeenCalledOnce();

    clock.setFrozen(false);
    expect(clock.isFrozen).toBe(false);
    expect(startTicker).toHaveBeenCalledOnce();
  });

  it("setFrozen with same value is a no-op", () => {
    const { clock, stopTicker, startTicker } = createClock();
    clock.setFrozen(false);
    expect(stopTicker).not.toHaveBeenCalled();
    expect(startTicker).not.toHaveBeenCalled();
  });
});

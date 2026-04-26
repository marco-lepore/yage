import { describe, expect, it, vi } from "vitest";
import { DebugClock } from "./DebugClock.js";

function createClock(options?: { manual?: boolean }) {
  const gameLoop = { tick: vi.fn(), fixedTimestep: 20 };
  const stopTicker = vi.fn();
  const startTicker = vi.fn();
  const render = vi.fn();
  const clock = new DebugClock(gameLoop, stopTicker, startTicker, render);
  if (options?.manual) clock.setManual(true);
  return { clock, gameLoop, stopTicker, startTicker, render };
}

describe("DebugClock", () => {
  it("defaults to auto mode", () => {
    const { clock } = createClock();
    expect(clock.isManual).toBe(false);
  });

  it("stopAuto enters manual mode and stops the ticker", () => {
    const { clock, stopTicker } = createClock();
    clock.stopAuto();
    expect(clock.isManual).toBe(true);
    expect(stopTicker).toHaveBeenCalledOnce();
  });

  it("startAuto exits manual mode and starts the ticker", () => {
    const { clock, startTicker } = createClock({ manual: true });
    clock.startAuto();
    expect(clock.isManual).toBe(false);
    expect(startTicker).toHaveBeenCalledOnce();
  });

  it("stopAuto is idempotent when already manual", () => {
    const { clock, stopTicker } = createClock({ manual: true });
    stopTicker.mockClear();
    clock.stopAuto();
    expect(stopTicker).not.toHaveBeenCalled();
  });

  it("startAuto is idempotent when already auto", () => {
    const { clock, startTicker } = createClock();
    clock.startAuto();
    expect(startTicker).not.toHaveBeenCalled();
  });

  it("step throws when not in manual mode", () => {
    const { clock } = createClock();
    expect(() => clock.step()).toThrow("Manual clock is not active.");
  });

  it("step uses fixedTimestep as default dt", () => {
    const { clock, gameLoop, render } = createClock({ manual: true });
    clock.step();
    expect(gameLoop.tick).toHaveBeenCalledWith(20);
    expect(render).toHaveBeenCalledOnce();
  });

  it("step passes custom dt", () => {
    const { clock, gameLoop } = createClock({ manual: true });
    clock.step(10);
    expect(gameLoop.tick).toHaveBeenCalledWith(10);
  });

  it("tracks manual logical frames", () => {
    const { clock } = createClock({ manual: true });
    expect(clock.getFrame()).toBe(0);
    clock.step();
    clock.step();
    expect(clock.getFrame()).toBe(2);
  });

  it("stepFrames calls tick and render n times", () => {
    const { clock, gameLoop, render } = createClock({ manual: true });
    clock.stepFrames(3);
    expect(gameLoop.tick).toHaveBeenCalledTimes(3);
    expect(render).toHaveBeenCalledTimes(3);
    expect(gameLoop.tick).toHaveBeenNthCalledWith(1, 20);
    expect(gameLoop.tick).toHaveBeenNthCalledWith(2, 20);
    expect(gameLoop.tick).toHaveBeenNthCalledWith(3, 20);
  });

  it("stepFrames with custom dt passes it to each step", () => {
    const { clock, gameLoop } = createClock({ manual: true });
    clock.stepFrames(2, 8);
    expect(gameLoop.tick).toHaveBeenNthCalledWith(1, 8);
    expect(gameLoop.tick).toHaveBeenNthCalledWith(2, 8);
  });

  it("stepFrames rejects non-integer count", () => {
    const { clock } = createClock({ manual: true });
    expect(() => clock.stepFrames(1.5)).toThrow("non-negative integer");
  });

  it("stepFrames rejects negative count", () => {
    const { clock } = createClock({ manual: true });
    expect(() => clock.stepFrames(-1)).toThrow("non-negative integer");
  });

  it("setManual round-trips correctly", () => {
    const { clock, stopTicker, startTicker } = createClock();
    clock.setManual(true);
    expect(clock.isManual).toBe(true);
    expect(stopTicker).toHaveBeenCalledOnce();

    clock.setManual(false);
    expect(clock.isManual).toBe(false);
    expect(startTicker).toHaveBeenCalledOnce();
  });

  it("setManual with same value is a no-op", () => {
    const { clock, stopTicker, startTicker } = createClock();
    clock.setManual(false);
    expect(stopTicker).not.toHaveBeenCalled();
    expect(startTicker).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { prefersTouchControls } from "./detect.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("prefersTouchControls", () => {
  it("is false without a window (SSR / node)", () => {
    expect(prefersTouchControls()).toBe(false);
  });

  it("is true when the primary pointer is coarse", () => {
    vi.stubGlobal("window", {
      matchMedia: (q: string) => ({ matches: q === "(pointer: coarse)" }),
    });
    expect(prefersTouchControls()).toBe(true);
  });

  it("is false on fine-pointer devices even with a touch screen", () => {
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: false }),
    });
    vi.stubGlobal("navigator", { maxTouchPoints: 5 });
    expect(prefersTouchControls()).toBe(false);
  });

  it("falls back to maxTouchPoints when matchMedia is unavailable", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { maxTouchPoints: 2 });
    expect(prefersTouchControls()).toBe(true);

    vi.stubGlobal("navigator", { maxTouchPoints: 0 });
    expect(prefersTouchControls()).toBe(false);
  });

  it("falls back to maxTouchPoints when matchMedia throws", () => {
    vi.stubGlobal("window", {
      matchMedia: () => {
        throw new Error("unsupported");
      },
    });
    vi.stubGlobal("navigator", { maxTouchPoints: 1 });
    expect(prefersTouchControls()).toBe(true);
  });
});

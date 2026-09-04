import { describe, expect, it, vi } from "vitest";
import { VirtualControlsModel } from "./model.js";
import type { ViewportRect, VirtualControlsConfig } from "./types.js";
import type { VirtualControlsModelCallbacks } from "./model.js";

const VP = { x: 0, y: 0, width: 800, height: 600 };

function makeModel(
  config: VirtualControlsConfig,
  callbacks?: VirtualControlsModelCallbacks,
): VirtualControlsModel {
  const model = new VirtualControlsModel(config, callbacks);
  model.setViewport(VP);
  return model;
}

describe("VirtualControlsModel — routing", () => {
  it("claims a button press and reports it", () => {
    const onButtonPress = vi.fn();
    const model = makeModel({ buttons: [{ id: "a" }] }, { onButtonPress });
    const { center } = model.buttons[0]!.layout;
    expect(model.pointerDown(7, center.x, center.y)).toBe(true);
    expect(model.buttons[0]!.pressed).toBe(true);
    expect(onButtonPress).toHaveBeenCalledOnce();
  });

  it("buttons claim before sticks when they overlap a stick zone", () => {
    const model = makeModel({
      stick: {},
      buttons: [{ id: "a", placement: { left: 200, bottom: 200 } }],
    });
    const { center } = model.buttons[0]!.layout;
    // Inside both the button circle and the stick's floating zone.
    expect(model.stick()!.hitTest(center.x, center.y)).toBe(true);
    model.pointerDown(1, center.x, center.y);
    expect(model.buttons[0]!.pressed).toBe(true);
    expect(model.stick()!.active).toBe(false);
  });

  it("misses return false and claim nothing", () => {
    const model = makeModel({ stick: {}, buttons: [{ id: "a" }] });
    expect(model.pointerDown(1, 780, 20)).toBe(false);
    expect(model.stick()!.active).toBe(false);
    expect(model.buttons[0]!.pressed).toBe(false);
  });

  it("routes two pointers to two controls independently", () => {
    const model = makeModel({ stick: {}, buttons: [{ id: "a" }] });
    const btn = model.buttons[0]!.layout.center;
    expect(model.pointerDown(1, 150, 400)).toBe(true); // stick zone
    expect(model.pointerDown(2, btn.x, btn.y)).toBe(true);
    expect(model.stick()!.pointerId).toBe(1);
    expect(model.buttons[0]!.pointerId).toBe(2);

    model.pointerMove(1, 220, 400);
    expect(model.stick()!.value.x).toBeGreaterThan(0);

    model.pointerUp(2);
    expect(model.buttons[0]!.pressed).toBe(false);
    expect(model.stick()!.active).toBe(true);
  });

  it("a second pointer cannot steal a pressed button", () => {
    const model = makeModel({ buttons: [{ id: "a" }] });
    const { center } = model.buttons[0]!.layout;
    model.pointerDown(1, center.x, center.y);
    expect(model.pointerDown(2, center.x, center.y)).toBe(false);
    expect(model.buttons[0]!.pointerId).toBe(1);
  });
});

describe("VirtualControlsModel — slide behavior", () => {
  it("releaseOnLeave releases past the slop ring", () => {
    const onButtonRelease = vi.fn();
    const model = makeModel({ buttons: [{ id: "a" }] }, { onButtonRelease });
    const { center, radius } = model.buttons[0]!.layout;
    model.pointerDown(1, center.x, center.y);
    // Inside the 1.15 slop: still held.
    model.pointerMove(1, center.x + radius * 1.1, center.y);
    expect(model.buttons[0]!.pressed).toBe(true);
    model.pointerMove(1, center.x + radius * 1.2, center.y);
    expect(model.buttons[0]!.pressed).toBe(false);
    expect(onButtonRelease).toHaveBeenCalledOnce();
  });

  it("releaseOnLeave: false keeps the press while sliding off", () => {
    const model = makeModel({
      buttons: [{ id: "a", releaseOnLeave: false }],
    });
    const { center, radius } = model.buttons[0]!.layout;
    model.pointerDown(1, center.x, center.y);
    model.pointerMove(1, center.x + radius * 3, center.y);
    expect(model.buttons[0]!.pressed).toBe(true);
    model.pointerUp(1);
    expect(model.buttons[0]!.pressed).toBe(false);
  });

  it("pressOnEnter claims a stray pointer that slides in", () => {
    const model = makeModel({
      buttons: [{ id: "a", pressOnEnter: true }],
    });
    const { center } = model.buttons[0]!.layout;
    expect(model.pointerDown(1, 100, 100)).toBe(false); // stray
    expect(model.pointerMove(1, center.x, center.y)).toBe(true); // slide-in claims
    expect(model.buttons[0]!.pressed).toBe(true);
    expect(model.buttons[0]!.pointerId).toBe(1);
  });

  it("a rolled-off pointer can roll onto the next pressOnEnter button", () => {
    const model = makeModel({
      buttons: [
        { id: "a", pressOnEnter: true },
        { id: "b", pressOnEnter: true },
      ],
    });
    const a = model.buttons[0]!.layout.center;
    const b = model.buttons[1]!.layout.center;
    model.pointerDown(1, a.x, a.y);
    expect(model.buttons[0]!.pressed).toBe(true);
    model.pointerMove(1, b.x, b.y); // off a (release) …
    expect(model.buttons[0]!.pressed).toBe(false);
    model.pointerMove(1, b.x, b.y); // … and onto b
    expect(model.buttons[1]!.pressed).toBe(true);
  });

  it("without pressOnEnter a slide-in does nothing", () => {
    const model = makeModel({ buttons: [{ id: "a" }] });
    const { center } = model.buttons[0]!.layout;
    model.pointerDown(1, 100, 100);
    expect(model.pointerMove(1, center.x, center.y)).toBe(false);
    expect(model.buttons[0]!.pressed).toBe(false);
  });
});

describe("VirtualControlsModel — button state", () => {
  it("hidden and disabled buttons do not claim direct presses", () => {
    const model = makeModel({ buttons: [{ id: "a" }] });
    const button = model.button("a")!;
    const { center } = button.layout;

    model.setButtonVisible("a", false);
    expect(button.visible).toBe(false);
    expect(model.pointerDown(1, center.x, center.y)).toBe(false);

    model.setButtonVisible("a", true);
    model.setButtonEnabled("a", false);
    expect(button.enabled).toBe(false);
    expect(model.pointerDown(2, center.x, center.y)).toBe(false);

    model.setButtonEnabled("a", true);
    expect(model.pointerDown(3, center.x, center.y)).toBe(true);
  });

  it("hidden and disabled buttons do not claim slide-ins", () => {
    const model = makeModel({
      buttons: [{ id: "a", pressOnEnter: true }],
    });
    const { center } = model.button("a")!.layout;

    model.setButtonVisible("a", false);
    model.pointerDown(1, 100, 100);
    expect(model.pointerMove(1, center.x, center.y)).toBe(false);

    model.setButtonVisible("a", true);
    model.setButtonEnabled("a", false);
    expect(model.pointerMove(1, center.x, center.y)).toBe(false);

    model.setButtonEnabled("a", true);
    expect(model.pointerMove(1, center.x, center.y)).toBe(true);
  });

  it("hiding or disabling a held button releases its pointer once", () => {
    const onButtonRelease = vi.fn();
    const model = makeModel({ buttons: [{ id: "a" }] }, { onButtonRelease });
    const button = model.button("a")!;
    const { center } = button.layout;

    model.pointerDown(1, center.x, center.y);
    model.setButtonVisible("a", false);
    expect(button.pressed).toBe(false);
    expect(button.pointerId).toBeNull();
    model.pointerUp(1);
    expect(onButtonRelease).toHaveBeenCalledTimes(1);

    model.setButtonVisible("a", true);
    model.pointerDown(2, center.x, center.y);
    model.setButtonEnabled("a", false);
    expect(button.pressed).toBe(false);
    expect(button.pointerId).toBeNull();
    model.pointerUp(2);
    expect(onButtonRelease).toHaveBeenCalledTimes(2);
  });

  it("keeps hidden buttons in their layout slots", () => {
    const model = makeModel({
      buttons: [{ id: "a" }, { id: "b" }, { id: "x" }],
    });
    const before = model.button("b")!.layout;

    model.setButtonVisible("a", false);

    expect(model.button("b")!.layout).toEqual(before);
  });

  it("throws when a state setter receives an unknown button id", () => {
    const model = makeModel({ buttons: [{ id: "a" }] });
    expect(() => model.setButtonVisible("nope", false)).toThrow(
      'VirtualControls: unknown button id "nope".',
    );
    expect(() => model.setButtonEnabled("nope", false)).toThrow(
      'VirtualControls: unknown button id "nope".',
    );
  });
});

describe("VirtualControlsModel — lifecycle", () => {
  it("releaseAll releases every engaged control with callbacks", () => {
    const onStickRelease = vi.fn();
    const onButtonRelease = vi.fn();
    const model = makeModel(
      { stick: {}, buttons: [{ id: "a" }] },
      { onStickRelease, onButtonRelease },
    );
    const btn = model.buttons[0]!.layout.center;
    model.pointerDown(1, 150, 400);
    model.pointerDown(2, btn.x, btn.y);

    model.releaseAll();
    expect(model.stick()!.active).toBe(false);
    expect(model.buttons[0]!.pressed).toBe(false);
    expect(onStickRelease).toHaveBeenCalledOnce();
    expect(onButtonRelease).toHaveBeenCalledOnce();
  });

  it("setViewport re-resolves layouts and ignores no-ops", () => {
    const model = makeModel({ buttons: [{ id: "a" }] });
    const before = model.buttons[0]!.layout.center.x;
    model.setViewport({ x: 0, y: 0, width: 1600, height: 600 });
    const after = model.buttons[0]!.layout.center.x;
    expect(after).toBeGreaterThan(before);
  });

  it("setViewport rejects non-finite and non-positive geometry", () => {
    const model = new VirtualControlsModel({ stick: {} });
    expect(() =>
      model.setViewport({
        x: 0,
        y: 0,
        width: 800,
      } as unknown as ViewportRect),
    ).toThrow(
      "VirtualControlsModel.setViewport(): height must be finite, got undefined.",
    );
    expect(() =>
      model.setViewport({ x: Number.NaN, y: 0, width: 800, height: 600 }),
    ).toThrow("VirtualControlsModel.setViewport(): x must be finite, got NaN.");
    expect(() =>
      model.setViewport({ x: 0, y: 0, width: 0, height: 600 }),
    ).toThrow(
      "VirtualControlsModel.setViewport(): width and height must be > 0, got 0×600.",
    );
  });

  it("a relayout releases a held button that moved out from under the finger", () => {
    const onButtonRelease = vi.fn();
    const model = makeModel({ buttons: [{ id: "a" }] }, { onButtonRelease });
    const { center } = model.buttons[0]!.layout;
    model.pointerDown(1, center.x, center.y);
    expect(model.buttons[0]!.pressed).toBe(true);

    // The cluster re-anchors on the larger viewport; the stationary finger
    // no longer covers the button, so releaseOnLeave fires with no move.
    model.setViewport({ x: 0, y: 0, width: 4000, height: 3000 });
    expect(model.buttons[0]!.pressed).toBe(false);
    expect(onButtonRelease).toHaveBeenCalledOnce();
  });

  it("canClaim gates slide-in claims only", () => {
    let allow = false;
    const model = makeModel(
      { buttons: [{ id: "a", pressOnEnter: true }] },
      { canClaim: () => allow },
    );
    const { center } = model.buttons[0]!.layout;

    // Down-claims are the host's gate, not canClaim's: this claim goes through.
    expect(model.pointerDown(1, center.x, center.y)).toBe(true);
    model.pointerUp(1);

    // Slide-in claims consult canClaim.
    model.pointerDown(2, 100, 100);
    expect(model.pointerMove(2, center.x, center.y)).toBe(false);
    expect(model.buttons[0]!.pressed).toBe(false);
    allow = true;
    expect(model.pointerMove(2, center.x, center.y)).toBe(true);
    expect(model.buttons[0]!.pressed).toBe(true);
  });

  it("looks up controls by id", () => {
    const model = makeModel({
      sticks: [{}, {}],
      buttons: [{ id: "a" }],
    });
    expect(model.stick()?.id).toBe("left");
    expect(model.stick("right")?.id).toBe("right");
    expect(model.button("a")?.id).toBe("a");
    expect(model.button("nope")).toBeUndefined();
  });
});

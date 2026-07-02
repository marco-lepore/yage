import { describe, expect, it, vi } from "vitest";
import {
  createMockEntity,
  RendererAdapterKey,
  type RendererAdapter,
} from "@yagejs/core";
import { InputManager, InputManagerKey } from "@yagejs/input";
import { VirtualControls } from "./VirtualControls.js";
import type { VirtualControlsOptions } from "./VirtualControls.js";
import {
  VirtualButtonPressEvent,
  VirtualButtonReleaseEvent,
  VirtualStickEngageEvent,
  VirtualStickReleaseEvent,
} from "./events.js";

const VIEWPORT = { x: 0, y: 0, width: 800, height: 600 };

const ACTIONS = {
  jump: ["Space"],
  fire: ["MouseLeft"],
  left: ["KeyA"],
  right: ["KeyD"],
  up: ["KeyW"],
  down: ["KeyS"],
};

function setup(options?: Partial<VirtualControlsOptions>) {
  const { entity, scene, context } = createMockEntity("controls-host");
  const input = new InputManager();
  input.setActionMap(ACTIONS);
  context.register(InputManagerKey, input);

  const controls = new VirtualControls({
    viewport: VIEWPORT,
    visible: true,
    stick: { actions: { left: "left", right: "right", up: "up", down: "down" } },
    buttons: [{ id: "a", action: "jump" }],
    ...options,
  });
  entity.add(controls);
  return { entity, scene, context, input, controls };
}

/**
 * Drive the DOM event path: enqueue (listeners fire, claims + consumption
 * happen) then drain at the simulated next EarlyUpdate (action edges apply,
 * consumed pointers excluded).
 */
function touchDown(input: InputManager, id: number, x: number, y: number) {
  input._enqueuePointerDown({
    id,
    screenX: x,
    screenY: y,
    type: "touch",
    isPrimary: false,
    button: 0,
  });
  input._drainInputQueue();
}

function touchMove(input: InputManager, id: number, x: number, y: number) {
  input._enqueuePointerMove({
    id,
    screenX: x,
    screenY: y,
    type: "touch",
    isPrimary: false,
    button: -1,
  });
}

function touchUp(input: InputManager, id: number, x: number, y: number) {
  input._enqueuePointerUp({
    id,
    screenX: x,
    screenY: y,
    type: "touch",
    isPrimary: false,
    button: 0,
  });
  input._drainInputQueue();
}

describe("VirtualControls — action mirroring", () => {
  it("a button press behaves like a held physical key", () => {
    const { input, controls } = setup();
    const { center } = controls.button("a")!.layout;

    touchDown(input, 7, center.x, center.y);
    expect(input.isPressed("jump")).toBe(true);
    expect(input.isJustPressed("jump")).toBe(true);

    input._clearFrameState();
    expect(input.isPressed("jump")).toBe(true);
    expect(input.isJustPressed("jump")).toBe(false);

    touchUp(input, 7, center.x, center.y);
    expect(input.isPressed("jump")).toBe(false);
    expect(input.isJustReleased("jump")).toBe(true);
  });

  it("stick deflection drives the four digital actions with getVector", () => {
    const { input, controls } = setup();
    const stick = controls.stick()!;

    touchDown(input, 9, 150, 400); // inside the left floating zone
    expect(stick.active).toBe(true);

    touchMove(input, 9, 150 + stick.layout.radius * 2, 400); // full right
    expect(input.isPressed("right")).toBe(true);
    expect(input.isPressed("left")).toBe(false);
    expect(input.getVector("left", "right", "up", "down").x).toBe(1);

    touchMove(input, 9, 150 - stick.layout.radius * 2, 400); // full left
    expect(input.isPressed("right")).toBe(false);
    expect(input.isPressed("left")).toBe(true);

    touchUp(input, 9, 150, 400);
    expect(input.isPressed("left")).toBe(false);
  });

  it("mirrors analog deflection onto getStick via synthetic axes", () => {
    const { input } = setup();
    touchDown(input, 9, 150, 400);
    touchMove(input, 9, 150 + 33, 400); // half deflection at radius 66
    expect(input.getStick("left").x).toBeGreaterThan(0);
    expect(input.getStick("left").x).toBeLessThan(1);

    touchUp(input, 9, 150, 400);
    expect(input.getStick("left").x).toBe(0);
  });

  it("skips unknown action names instead of throwing mid-gesture", () => {
    const { input, controls } = setup({
      buttons: [{ id: "a", action: "not-an-action" }],
    });
    const { center } = controls.button("a")!.layout;
    expect(() => touchDown(input, 7, center.x, center.y)).not.toThrow();
    expect(controls.button("a")!.pressed).toBe(true);
  });

  it("re-validates action names live across a setActionMap swap", () => {
    const { input, controls } = setup();
    const { center } = controls.button("a")!.layout;

    // Swap to a map WITHOUT "jump" mid-session: pressing must not throw.
    input.setActionMap({ fire: ["MouseLeft"] });
    expect(() => touchDown(input, 7, center.x, center.y)).not.toThrow();
    touchUp(input, 7, center.x, center.y);

    // Swap it back in: the same binding works again without a remount.
    input.setActionMap(ACTIONS);
    touchDown(input, 8, center.x, center.y);
    expect(input.isPressed("jump")).toBe(true);
  });

  it("does not force-release synthetic holds owned by other code", () => {
    const { input } = setup();
    // A cutscene (or any other system) holds "up" by name.
    input.fireActionDown("up");

    // Resting a thumb on the stick and wiggling below threshold used to
    // fire setActionHeld(..., false) for every direction on every move.
    touchDown(input, 9, 150, 400);
    touchMove(input, 9, 155, 400);
    expect(input.isPressed("up")).toBe(true);

    // Deflect fully right, then back to center: only the stick's OWN
    // transitions mirror. The foreign "up" hold survives throughout.
    touchMove(input, 9, 150 + 132, 400);
    expect(input.isPressed("right")).toBe(true);
    touchMove(input, 9, 150, 400);
    expect(input.isPressed("right")).toBe(false);
    expect(input.isPressed("up")).toBe(true);

    touchUp(input, 9, 150, 400);
    expect(input.isPressed("up")).toBe(true);
  });

  it("keeps a mouse-driven stick engaged across a secondary-button release", () => {
    const { input, controls } = setup();
    // Left button down inside the stick zone (mouse pointer id 1).
    input._enqueuePointerDown({
      id: 1, screenX: 150, screenY: 400, type: "mouse", isPrimary: true, button: 0,
    });
    input._drainInputQueue();
    expect(controls.stick()!.active).toBe(true);

    // Right button down + up mid-drag: down is skipped (pointer consumed),
    // and its release must not end the left-button gesture.
    input._enqueuePointerDown({
      id: 1, screenX: 150, screenY: 400, type: "mouse", isPrimary: true, button: 2,
    });
    input._drainInputQueue();
    input._enqueuePointerUp({
      id: 1, screenX: 150, screenY: 400, type: "mouse", isPrimary: true, button: 2,
    });
    input._drainInputQueue();
    expect(controls.stick()!.active).toBe(true);

    input._enqueuePointerUp({
      id: 1, screenX: 150, screenY: 400, type: "mouse", isPrimary: true, button: 0,
    });
    input._drainInputQueue();
    expect(controls.stick()!.active).toBe(false);
  });

  it("re-mirrors an engaged stick when the viewport changes mid-gesture", () => {
    const { input, controls } = setup();
    touchDown(input, 9, 150, 400);
    touchMove(input, 9, 150 + 132, 400); // full right at radius 66
    expect(input.isPressed("right")).toBe(true);

    // Stationary finger, new geometry: the model replays the last pointer
    // position (282, 400) with no pointermove. On a 3000×3000 viewport the
    // zone floor moves to y=900, the engaged base clamps to (150, 900), and
    // the replayed deflection points mostly UP — so "right" must release
    // and "up" must engage purely from the relayout.
    controls.model.setViewport({ x: 0, y: 0, width: 3000, height: 3000 });
    expect(controls.stick()!.active).toBe(true);
    expect(input.isPressed("right")).toBe(false);
    expect(input.isPressed("up")).toBe(true);
  });
});

describe("VirtualControls — pointer consumption", () => {
  it("consumes claimed pointers so no MouseLeft action edge leaks", () => {
    const { input, controls } = setup();
    const { center } = controls.button("a")!.layout;

    touchDown(input, 7, center.x, center.y);
    expect(input.isPointerConsumed(7)).toBe(true);
    expect(input.isPressed("fire")).toBe(false);
    expect(input.isJustPressed("fire")).toBe(false);

    // Stick zone touches are consumed too.
    touchDown(input, 8, 150, 400);
    expect(input.isPointerConsumed(8)).toBe(true);
    expect(input.isPressed("fire")).toBe(false);
  });

  it("leaves unclaimed touches to gameplay", () => {
    const { input } = setup();
    touchDown(input, 7, 780, 30); // empty top-right corner
    expect(input.isPointerConsumed(7)).toBe(false);
    expect(input.isPressed("fire")).toBe(true);
  });

  it("skips pointers that land on UI surfaces (hitTestUI wins)", () => {
    const { entity, context, input } = (() => {
      const parts = createMockEntity("controls-host");
      const im = new InputManager();
      im.setActionMap(ACTIONS);
      parts.context.register(InputManagerKey, im);
      const adapter: RendererAdapter = {
        canvas: {
          clientWidth: 800,
          clientHeight: 600,
        } as unknown as HTMLCanvasElement,
        hitTestUI: () => true,
      };
      parts.context.register(RendererAdapterKey, adapter);
      return { ...parts, input: im };
    })();
    const controls = new VirtualControls({
      visible: true,
      stick: {},
    });
    entity.add(controls);

    touchDown(input, 7, 150, 400); // in-zone, but "on UI"
    expect(controls.stick()!.active).toBe(false);
    expect(input.isPointerConsumed(7)).toBe(false);
    void context;
  });

  it("prefers the adapter's clamped visibleVirtualRect over corner mapping", () => {
    const parts = createMockEntity("controls-host");
    const im = new InputManager();
    im.setActionMap(ACTIONS);
    parts.context.register(InputManagerKey, im);
    // A letterbox-shaped adapter: corner mapping would span y -200..800,
    // but the clamped rect is the 800×600 design space.
    const adapter: RendererAdapter = {
      canvas: { clientWidth: 800, clientHeight: 1000 } as unknown as HTMLCanvasElement,
      canvasToVirtual: (x, y) => ({ x, y: y - 200 }),
      visibleVirtualRect: { x: 0, y: 0, width: 800, height: 600 },
    };
    parts.context.register(RendererAdapterKey, adapter);

    const controls = new VirtualControls({ visible: true, buttons: [{ id: "a" }] });
    parts.entity.add(controls);

    const { center, radius } = controls.button("a")!.layout;
    // Laid out inside the clamped rect — not in the would-be letterbox bar.
    expect(center.y + radius).toBeLessThanOrEqual(600);
  });
});

describe("VirtualControls — visibility", () => {
  it("hidden controls claim nothing", () => {
    const { input, controls } = setup({ visible: false });
    touchDown(input, 7, 150, 400);
    expect(controls.stick()!.active).toBe(false);
    expect(input.isPointerConsumed(7)).toBe(false);
    expect(input.isPressed("fire")).toBe(true); // reached gameplay
  });

  it("hiding mid-hold releases mirrored actions", () => {
    const { input, controls } = setup();
    const { center } = controls.button("a")!.layout;
    touchDown(input, 7, center.x, center.y);
    expect(input.isPressed("jump")).toBe(true);

    controls.setVisible(false);
    expect(input.isPressed("jump")).toBe(false);
    expect(input.isJustReleased("jump")).toBe(true);
    expect(controls.button("a")!.pressed).toBe(false);
  });

  it("a paused scene takes no new claims but existing gestures release", () => {
    const { input, controls, scene } = setup();
    const { center } = controls.button("a")!.layout;
    touchDown(input, 7, center.x, center.y);
    expect(input.isPressed("jump")).toBe(true);

    scene.paused = true;
    touchDown(input, 8, 150, 400); // new claim blocked
    expect(controls.stick()!.active).toBe(false);

    touchUp(input, 7, center.x, center.y); // release still flows
    expect(input.isPressed("jump")).toBe(false);
  });

  it("a paused scene blocks pressOnEnter slide-in claims too", () => {
    const { input, controls, scene } = setup({
      buttons: [{ id: "a", action: "jump", pressOnEnter: true }],
    });
    const { center } = controls.button("a")!.layout;
    touchDown(input, 7, 700, 30); // stray on empty space, pre-pause

    scene.paused = true;
    touchMove(input, 7, center.x, center.y); // slide onto the button
    expect(controls.button("a")!.pressed).toBe(false);
    expect(input.isPressed("jump")).toBe(false);

    // Unpaused, the same stray may claim again.
    scene.paused = false;
    touchMove(input, 7, center.x + 1, center.y);
    expect(controls.button("a")!.pressed).toBe(true);
  });

  it("visible: 'auto' resolves false without a window (SSR/node)", () => {
    const { controls } = setup({ visible: "auto" });
    expect(controls.visible).toBe(false);
  });
});

describe("VirtualControls — events + teardown", () => {
  it("emits entity events for presses, releases and stick engagement", () => {
    const { entity, input, controls } = setup();
    const events: string[] = [];
    entity.on(VirtualButtonPressEvent, (e) => events.push(`press:${e.id}:${e.action}`));
    entity.on(VirtualButtonReleaseEvent, (e) => events.push(`release:${e.id}`));
    entity.on(VirtualStickEngageEvent, (e) => events.push(`engage:${e.id}`));
    entity.on(VirtualStickReleaseEvent, (e) => events.push(`disengage:${e.id}`));

    const { center } = controls.button("a")!.layout;
    touchDown(input, 7, center.x, center.y);
    touchUp(input, 7, center.x, center.y);
    touchDown(input, 8, 150, 400);
    touchUp(input, 8, 150, 400);

    expect(events).toEqual([
      "press:a:jump",
      "release:a",
      "engage:left",
      "disengage:left",
    ]);
  });

  it("destroying the host entity releases holds and stops listening", () => {
    const { entity, scene, input, controls } = setup();
    const { center } = controls.button("a")!.layout;
    touchDown(input, 7, center.x, center.y);
    expect(input.isPressed("jump")).toBe(true);

    entity.destroy();
    scene._flushDestroyQueue(); // entity destruction is end-of-frame deferred
    expect(input.isPressed("jump")).toBe(false);

    // Listeners are gone: a fresh touch on the old button spot is inert.
    touchDown(input, 9, center.x, center.y);
    expect(input.isPointerConsumed(9)).toBe(false);
  });

  it("update drives the presenter views", () => {
    const view = { update: vi.fn(), setVisible: vi.fn(), dispose: vi.fn() };
    const presenter = {
      mount: vi.fn(),
      createStickView: vi.fn(() => view),
      createButtonView: vi.fn(() => view),
      dispose: vi.fn(),
    };
    const { entity, scene, controls } = setup({ presenter });
    expect(presenter.mount).toHaveBeenCalledOnce();
    expect(presenter.createStickView).toHaveBeenCalledOnce();
    expect(presenter.createButtonView).toHaveBeenCalledOnce();

    controls.update(1 / 60);
    expect(view.update).toHaveBeenCalledTimes(2);

    entity.destroy();
    scene._flushDestroyQueue(); // entity destruction is end-of-frame deferred
    expect(view.dispose).toHaveBeenCalledTimes(2);
    expect(presenter.dispose).toHaveBeenCalledOnce();
  });
});

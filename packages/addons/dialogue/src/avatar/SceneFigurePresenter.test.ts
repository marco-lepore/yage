import { describe, expect, it, vi } from "vitest";
import {
  createMockScene,
  Transform,
  Vec2,
  type Entity,
  type Scene,
} from "@yagejs/core";

import type { LoadedSpeaker } from "../core/types.js";
import { SceneFigurePresenter } from "./SceneFigurePresenter.js";

function setup(): {
  scene: Scene;
  npc: Entity;
  presenter: SceneFigurePresenter;
  speaker: LoadedSpeaker;
} {
  const { scene } = createMockScene();
  const npc = scene.spawn("npc");
  npc.add(new Transform({ position: new Vec2(100, 50) }));
  const presenter = new SceneFigurePresenter();
  presenter.mount(scene);
  const speaker: LoadedSpeaker = {
    id: "npc",
    name: "NPC",
    avatar: { kind: "scene", ref: "npc" },
  };
  return { scene, npc, presenter, speaker };
}

describe("SceneFigurePresenter — talk bob vs entity movement", () => {
  it("releasing the bob returns an unmoved figure exactly to rest", () => {
    const { npc, presenter, speaker } = setup();
    const t = npc.get(Transform);
    presenter.setSpeaker(speaker);
    presenter.setSpeaking(true);
    presenter.update(0.04);
    presenter.update(0.04);
    expect(t.position.y).not.toBeCloseTo(50); // bob is actually applied
    presenter.setSpeaking(false);
    expect(t.position.x).toBe(100);
    expect(t.position.y).toBeCloseTo(50);
  });

  it("keeps an externally-moved figure at its new position (± bob amplitude)", () => {
    const { npc, presenter, speaker } = setup();
    const t = npc.get(Transform);
    presenter.setSpeaker(speaker);
    presenter.setSpeaking(true);
    presenter.update(0.04);

    // The NPC walks mid-line — the bob must ride on top, not pin it back.
    t.setPosition(140, 80);
    presenter.update(0.04);
    expect(t.position.x).toBe(140);
    expect(Math.abs(t.position.y - 80)).toBeLessThanOrEqual(2.5); // ≤ 2× amplitude

    presenter.setSpeaking(false); // removes only the residual offset
    expect(t.position.x).toBe(140);
    expect(Math.abs(t.position.y - 80)).toBeLessThanOrEqual(1.3); // ≤ amplitude
  });

  it("setSpeaker after the figure moved between lines does not teleport it", () => {
    const { npc, presenter, speaker } = setup();
    const t = npc.get(Transform);
    presenter.setSpeaker(speaker);
    presenter.setSpeaking(true);
    presenter.update(0.04);
    presenter.setSpeaking(false); // line ends; bob fully released

    t.setPosition(300, 200); // NPC repositioned between lines
    presenter.setSpeaker(speaker); // next line, same figure
    expect(t.position.x).toBe(300);
    expect(t.position.y).toBe(200);
  });

  it("sleeps fallback callbacks and bobbing while the figure is inactive", () => {
    const { scene, npc, speaker } = setup();
    const onExpression = vi.fn();
    const onSpeaking = vi.fn();
    const presenter = new SceneFigurePresenter({
      onExpression,
      onSpeaking,
    });
    presenter.mount(scene);
    presenter.setSpeaker(speaker);
    presenter.setExpression("angry");
    presenter.setSpeaking(true);
    presenter.update(0.04);
    const transform = npc.get(Transform);

    npc.setActive(false);
    presenter.update(0.04);
    expect(onSpeaking).toHaveBeenLastCalledWith(npc, false);
    const dormantY = transform.position.y;
    presenter.setExpression("calm");
    presenter.update(0.04);
    expect(transform.position.y).toBe(dormantY);

    npc.setActive(true);
    presenter.update(0.04);
    expect(onExpression).toHaveBeenLastCalledWith(npc, "calm");
    expect(onSpeaking).toHaveBeenLastCalledWith(npc, true);
  });

  it("finds an initially inactive fallback figure and applies state when it activates", () => {
    const { scene, npc, speaker } = setup();
    const onExpression = vi.fn();
    const onSpeaking = vi.fn();
    const presenter = new SceneFigurePresenter({
      onExpression,
      onSpeaking,
    });
    presenter.mount(scene);
    npc.setActive(false);

    presenter.setSpeaker(speaker);
    presenter.setExpression("calm");
    presenter.setSpeaking(true);
    presenter.update(0.04);
    expect(onExpression).not.toHaveBeenCalled();
    expect(onSpeaking).not.toHaveBeenCalled();

    npc.setActive(true);
    presenter.update(0.04);
    expect(onExpression).toHaveBeenLastCalledWith(npc, "calm");
    expect(onSpeaking).toHaveBeenLastCalledWith(npc, true);
  });
});

describe("SceneFigurePresenter — [expression] marker bridge", () => {
  it("interprets an [expression=…/] marker as its own setExpression, and ignores other names", () => {
    const { scene } = createMockScene();
    const npc = scene.spawn("npc");
    npc.add(new Transform({ position: new Vec2(0, 0) }));
    const seen: (string | undefined)[] = [];
    const presenter = new SceneFigurePresenter({
      onExpression: (_fig, e) => seen.push(e),
    });
    presenter.mount(scene);
    presenter.setSpeaker({ id: "npc", name: "NPC", avatar: { kind: "scene", ref: "npc" } });

    // A mid-line face change — the presenter interprets the marker itself; the
    // session does not name-match.
    presenter.marker({ kind: "marker", atChar: 4, name: "expression", props: { expression: "happy" } });
    expect(seen).toEqual(["happy"]);

    // Any other marker name is ignored (the session fans every name; the presenter
    // only owns `expression`).
    presenter.marker({ kind: "marker", atChar: 6, name: "sfx", props: { sfx: "ding" } });
    expect(seen).toEqual(["happy"]);
  });
});

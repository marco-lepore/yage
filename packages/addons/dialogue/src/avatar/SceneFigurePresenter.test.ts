import { describe, expect, it } from "vitest";
import {
  createMockScene,
  Transform,
  Vec2,
  type Entity,
  type Scene,
} from "@yagejs/core";

import type { SpeakerDef } from "../core/types.js";
import { SceneFigurePresenter } from "./SceneFigurePresenter.js";

function setup(): {
  scene: Scene;
  npc: Entity;
  presenter: SceneFigurePresenter;
  speaker: SpeakerDef;
} {
  const { scene } = createMockScene();
  const npc = scene.spawn("npc");
  npc.add(new Transform({ position: new Vec2(100, 50) }));
  const presenter = new SceneFigurePresenter();
  presenter.mount(scene);
  const speaker: SpeakerDef = {
    id: "npc",
    name: "NPC",
    avatar: { kind: "scene", ref: "npc" },
  };
  return { scene, npc, presenter, speaker };
}

describe("SceneFigurePresenter — talk bob vs entity movement (F47)", () => {
  it("releasing the bob returns an unmoved figure exactly to rest", () => {
    const { npc, presenter, speaker } = setup();
    const t = npc.get(Transform);
    presenter.setSpeaker(speaker);
    presenter.setSpeaking(true);
    presenter.update(40);
    presenter.update(40);
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
    presenter.update(40);

    // The NPC walks mid-line — the bob must ride on top, not pin it back.
    t.setPosition(140, 80);
    presenter.update(40);
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
    presenter.update(40);
    presenter.setSpeaking(false); // line ends; bob fully released

    t.setPosition(300, 200); // NPC repositioned between lines
    presenter.setSpeaker(speaker); // next line, same figure
    expect(t.position.x).toBe(300);
    expect(t.position.y).toBe(200);
  });
});

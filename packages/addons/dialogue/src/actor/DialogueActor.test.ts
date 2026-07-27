import { describe, expect, it, vi } from "vitest";
import { createMockScene } from "@yagejs/core";
import { DialogueActor } from "./DialogueActor.js";
import { actorRegistryFor } from "./ActorRegistry.js";

describe("DialogueActor lifecycle", () => {
  it("does not invent expression or speaking callbacks on its initial enable", () => {
    const onExpression = vi.fn();
    const onSpeaking = vi.fn();
    const { scene } = createMockScene();

    scene.spawn("npc").add(
      new DialogueActor({
        speaker: "npc",
        onExpression,
        onSpeaking,
      }),
    );

    expect(onExpression).not.toHaveBeenCalled();
    expect(onSpeaking).not.toHaveBeenCalled();
  });

  it("registers only while the component is effectively enabled", () => {
    const { scene } = createMockScene();
    const host = scene.spawn("npc");
    const actor = host.add(new DialogueActor({ speaker: "npc" }));
    const registry = actorRegistryFor(scene);
    expect(registry.resolve("npc")).toBe(actor);

    actor.enabled = false;
    expect(registry.resolve("npc")).toBeUndefined();

    actor.enabled = true;
    expect(registry.resolve("npc")).toBe(actor);

    host.setActive(false);
    expect(registry.resolve("npc")).toBeUndefined();

    host.setActive(true);
    expect(registry.resolve("npc")).toBe(actor);
  });

  it("puts speaking callbacks to sleep and restores their requested state", () => {
    const onExpression = vi.fn();
    const onSpeaking = vi.fn();
    const { scene } = createMockScene();
    const actor = scene.spawn("npc").add(
      new DialogueActor({
        speaker: "npc",
        onExpression,
        onSpeaking,
      }),
    );
    onExpression.mockClear();
    onSpeaking.mockClear();

    actor.setExpression("angry");
    actor.setSpeaking(true);
    actor.enabled = false;

    expect(onSpeaking).toHaveBeenLastCalledWith(actor.entity, false);
    actor.setExpression("calm");
    actor.enabled = true;

    expect(onExpression).toHaveBeenLastCalledWith(actor.entity, "calm");
    expect(onSpeaking).toHaveBeenLastCalledWith(actor.entity, true);
  });
});

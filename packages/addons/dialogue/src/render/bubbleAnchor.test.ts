/**
 * D3 — the ONE shared missing-actor / narrator anchor resolver. Locks the
 * "scenario 3" policy: a bubble line stays readable somewhere sane (last-known,
 * near-the-action, or a configurable fallback) instead of vanishing at world
 * origin, and a dev warning fires once per missing speaker through the
 * diagnostics sink — never for an authored narrator line.
 */

import { describe, expect, it, vi } from "vitest";
import { createMockScene } from "@yagejs/core";

import { actorRegistryFor, type DialogueActor } from "../actor/index.js";
import { BubbleAnchorResolver } from "./bubbleAnchor.js";

/** A minimal stand-in for a registered actor (only `anchorWorld` is read). */
function fakeActor(x: number, y: number): DialogueActor {
  return { anchorWorld: () => ({ x, y }) } as unknown as DialogueActor;
}

describe("BubbleAnchorResolver — live actor", () => {
  it("uses a live actor's head anchor", () => {
    const { scene } = createMockScene();
    actorRegistryFor(scene).register("npc", fakeActor(10, 20));
    expect(new BubbleAnchorResolver().resolve(scene, "npc")).toEqual({ x: 10, y: 20 });
  });
});

describe("BubbleAnchorResolver — missing actor (F29/F31)", () => {
  it("falls back to the speaker's last-known position when it despawns", () => {
    const { scene } = createMockScene();
    const actor = fakeActor(30, 40);
    actorRegistryFor(scene).register("npc", actor);
    const r = new BubbleAnchorResolver();
    r.resolve(scene, "npc"); // caches last-known
    actorRegistryFor(scene).unregister("npc", actor); // despawn mid-conversation
    expect(r.resolve(scene, "npc")).toEqual({ x: 30, y: 40 }); // NOT the (0,0) bug
  });

  it("falls back to the most-recent any-speaker anchor for a never-seen speaker", () => {
    const { scene } = createMockScene();
    actorRegistryFor(scene).register("npc", fakeActor(5, 6));
    const r = new BubbleAnchorResolver();
    r.resolve(scene, "npc"); // sets the global last-anchor
    expect(r.resolve(scene, "ghost")).toEqual({ x: 5, y: 6 }); // near the action
  });

  it("uses the configurable fallback when nothing is known", () => {
    const { scene } = createMockScene();
    const r = new BubbleAnchorResolver(() => ({ x: 100, y: 200 }));
    expect(r.resolve(scene, "ghost")).toEqual({ x: 100, y: 200 });
  });

  it("defaults the fallback to the world origin", () => {
    const { scene } = createMockScene();
    expect(new BubbleAnchorResolver().resolve(scene, "ghost")).toEqual({ x: 0, y: 0 });
  });
});

describe("BubbleAnchorResolver — diagnostics (D3 routes to the Logger, not console)", () => {
  it("warns once per missing declared speaker through the sink", () => {
    const { scene } = createMockScene();
    const warn = vi.fn();
    const r = new BubbleAnchorResolver();
    r.setDiagnostics(warn);
    r.resolve(scene, "ghost");
    r.resolve(scene, "ghost"); // same id → deduped
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("ghost");
  });

  it("never warns for a speakerless narrator line (authored intent, not a failure)", () => {
    const { scene } = createMockScene();
    const warn = vi.fn();
    const r = new BubbleAnchorResolver();
    r.setDiagnostics(warn);
    r.resolve(scene, undefined);
    expect(warn).not.toHaveBeenCalled();
  });
});

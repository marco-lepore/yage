import { describe, it, expect } from "vitest";
import { ErrorBoundary, Logger, LogLevel } from "@yagejs/core";
import { SequenceClip } from "./evaluate.js";
import { parseSequence } from "./validate.js";
import { SequencePlayer, sequenceProperty } from "./SequencePlayer.js";
import type { SequenceDocument, SequenceCurve } from "./types.js";

function document(curve: SequenceCurve = "linear"): SequenceDocument {
  return {
    format: "yage-sequence",
    version: 1,
    name: "entrance",
    fps: 30,
    duration: 60,
    frame: { width: 800, height: 600 },
    targets: {
      actor: {
        properties: {
          position: { kind: "position" },
          rotation: { kind: "number" },
        },
        events: {
          cue: { label: { kind: "enum", values: ["start", "middle", "end"] } },
        },
      },
    },
    tracks: [
      {
        id: "position",
        target: "actor",
        property: "position",
        position: { mode: "proportional" },
        keys: [
          { id: "p0", frame: 0, value: { x: 0, y: 300 }, curve },
          { id: "p1", frame: 60, value: { x: 800, y: 300 }, curve: "linear" },
        ],
      },
      {
        id: "rotation",
        target: "actor",
        property: "rotation",
        keys: [
          { id: "r0", frame: 0, value: 0, curve: "linear" },
          { id: "r1", frame: 60, value: 2, curve: "linear" },
        ],
      },
    ],
    events: [
      {
        id: "start",
        target: "actor",
        event: "cue",
        frame: 0,
        payload: { label: "start" },
      },
      {
        id: "middle",
        target: "actor",
        event: "cue",
        frame: 30,
        payload: { label: "middle" },
      },
      {
        id: "end",
        target: "actor",
        event: "cue",
        frame: 60,
        payload: { label: "end" },
      },
    ],
  };
}
function setup() {
  const boundary = new ErrorBoundary(new Logger({ level: LogLevel.None }));
  const player = new SequencePlayer(boundary);
  const state = { position: { x: 17, y: 19 }, rotation: 7, alive: true };
  const events: { label: string; x: number; rotation: number }[] = [];
  const targets = {
    actor: {
      isAlive: () => state.alive,
      properties: {
        position: sequenceProperty(
          { kind: "position" },
          () => state.position,
          (v) => {
            state.position = v;
          },
        ),
        rotation: sequenceProperty(
          { kind: "number" },
          () => state.rotation,
          (v) => {
            state.rotation = v;
          },
        ),
      },
      events: {
        cue: {
          payload: document().targets.actor!.events.cue!,
          dispatch: (p: Readonly<Record<string, unknown>>) => {
            events.push({
              label: String(p.label),
              x: state.position.x,
              rotation: state.rotation,
            });
          },
        },
      },
    },
  };
  return { player, boundary, state, events, targets };
}
describe("sequence contract", () => {
  it("maps positions without applying scale and samples arbitrary frames independently", () => {
    const clip = new SequenceClip(document());
    expect(
      clip.sample(30, { frame: { x: 10, y: 20, width: 1600, height: 900 } }),
    ).toEqual([
      { target: "actor", property: "position", value: { x: 810, y: 470 } },
      { target: "actor", property: "rotation", value: 1 },
    ]);
    clip.sample(55);
    expect(clip.sample(0)[0]!.value).toEqual({ x: 0, y: 300 });
    expect(
      clip.sample(30, {
        frame: { x: 0, y: 0, width: 1600, height: 900 },
        fit: "contain",
      })[0]!.value,
    ).toEqual({ x: 800, y: 450 });
  });
  it("keeps anchored offsets in pixels", () => {
    const d = document();
    const track = {
      ...d.tracks[0]!,
      position: { mode: "anchored" as const, anchor: { x: 1, y: 1 } },
      keys: [
        {
          id: "p0",
          frame: 0,
          value: { x: -24, y: -40 },
          curve: "linear" as const,
        },
      ],
    };
    const clip = new SequenceClip({ ...d, tracks: [track] });
    expect(
      clip.sample(30, { frame: { x: 10, y: 20, width: 1600, height: 900 } })[0]!
        .value,
    ).toEqual({ x: 1586, y: 880 });
  });
  it("uses named easing, hold, and solves Bézier x before y", () => {
    expect(
      new SequenceClip(document("easeInQuad")).sample(30)[0]!.value,
    ).toEqual({ x: 200, y: 300 });
    expect(new SequenceClip(document("hold")).sample(59)[0]!.value).toEqual({
      x: 0,
      y: 300,
    });
    expect(new SequenceClip(document("hold")).sample(60)[0]!.value).toEqual({
      x: 800,
      y: 300,
    });
    const x = (
      new SequenceClip(document({ bezier: [0.42, 0, 1, 1] })).sample(30)[0]!
        .value as { x: number }
    ).x;
    expect(x).toBeCloseTo(252.285, 2);
  });
  it("interpolates colors by channel and steps enums and booleans", () => {
    const d = document();
    const c = {
      properties: {
        tint: { kind: "color" },
        visible: { kind: "boolean" },
        mood: { kind: "enum", values: ["idle", "wave"] },
      },
      events: {},
    };
    const tracks = [
      { property: "tint", values: [0xff0000, 0x0000ff], curve: "linear" },
      { property: "visible", values: [true, false], curve: "hold" },
      { property: "mood", values: ["idle", "wave"], curve: "hold" },
    ].map((t) => ({
      id: t.property,
      target: "actor",
      property: t.property,
      keys: t.values.map((value, i) => ({
        id: `${t.property}${i}`,
        frame: i * 60,
        value,
        curve: t.curve,
      })),
    }));
    const clip = new SequenceClip({
      ...d,
      targets: { actor: c },
      tracks,
      events: [],
    });
    expect(clip.sample(30).map((s) => s.value)).toEqual([
      0x800080,
      true,
      "idle",
    ]);
    expect(clip.sample(60).map((s) => s.value)).toEqual([
      0x0000ff,
      false,
      "wave",
    ]);
  });
  it("detaches and freezes the asset", () => {
    const d = JSON.parse(JSON.stringify(document())) as { name: string };
    const clip = new SequenceClip(d);
    d.name = "changed";
    expect(clip.document.name).toBe("entrance");
    expect(Object.isFrozen(clip.document.tracks[0]!.keys)).toBe(true);
  });
  it.each([
    { fps: 0 },
    { duration: Infinity },
    { version: 2 },
    { wat: 1 },
    { frame: { width: NaN, height: 2 } },
    {
      events: [
        { id: "x", target: "actor", event: "missing", frame: 2, payload: {} },
      ],
    },
  ])("rejects invalid document %j", (change) => {
    expect(() => parseSequence({ ...document(), ...change })).toThrow(
      "Sequence:",
    );
  });
  it("rejects repeated property tracks, IDs, invalid key times and event payloads", () => {
    const d = document();
    expect(
      () =>
        new SequenceClip({
          ...d,
          tracks: [...d.tracks, { ...d.tracks[0], id: "other" }],
        }),
    ).toThrow("duplicate property");
    expect(
      () => new SequenceClip({ ...d, events: [{ ...d.events[0], id: "p0" }] }),
    ).toThrow("duplicate id");
    expect(
      () =>
        new SequenceClip({
          ...d,
          tracks: [
            { ...d.tracks[0], keys: [{ ...d.tracks[0]!.keys[0], frame: 2 }] },
          ],
        }),
    ).toThrow("start at zero");
    expect(
      () =>
        new SequenceClip({
          ...d,
          events: [{ ...d.events[0], payload: { label: "typo" } }],
        }),
    ).toThrow("enum");
  });
});
describe("sequence playback", () => {
  it("visits event poses in a large update and keeps terminal values", () => {
    const s = setup();
    s.player.play(new SequenceClip(document()), { targets: s.targets });
    s.player.advance(2);
    expect(s.events).toEqual([
      { label: "start", x: 0, rotation: 0 },
      { label: "middle", x: 400, rotation: 1 },
      { label: "end", x: 800, rotation: 2 },
    ]);
    expect(s.state.position.x).toBe(800);
    expect(s.player.state).toBe("completed");
  });
  it("lands on markers and completion despite accumulated clock rounding", () => {
    const s = setup();
    s.player.play(new SequenceClip(document()), { targets: s.targets });
    for (let i = 0; i < 120; i++)
      s.player.advance((1 / 60) * (1 - Number.EPSILON * 4));
    expect(s.player.state).toBe("completed");
    expect(s.player.frame).toBe(60);
    expect(s.events.map((e) => e.label)).toEqual(["start", "middle", "end"]);
    s.player.cancel("restore");
    expect(s.state.position).toEqual({ x: 17, y: 19 });
  });
  it("does not lose crossed loops or repeat endpoints on the next tick", () => {
    const s = setup();
    s.player.play(new SequenceClip(document()), {
      targets: s.targets,
      loop: true,
    });
    s.player.advance(5);
    expect(s.events.map((e) => e.label)).toEqual([
      "start",
      "middle",
      "end",
      "start",
      "middle",
      "end",
      "start",
      "middle",
    ]);
    expect(s.player.frame).toBe(30);
    s.player.advance(0);
    expect(s.events).toHaveLength(8);
  });
  it("has silent seeks and explicit restore policies", () => {
    const s = setup();
    s.player.play(new SequenceClip(document()), {
      targets: s.targets,
      cancel: "restore",
    });
    s.player.seek(45);
    expect(s.events).toHaveLength(1);
    expect(s.state.position.x).toBe(600);
    s.player.cancel();
    expect(s.state.position).toEqual({ x: 17, y: 19 });
    expect(s.state.rotation).toBe(7);
    s.player.play(new SequenceClip(document()), {
      targets: s.targets,
      finish: "restore",
    });
    s.player.advance(2);
    expect(s.state.rotation).toBe(7);
  });
  it("pausing in a marker stops advancement and resumes remaining same-time markers", () => {
    const s = setup();
    const original = s.targets.actor.events.cue.dispatch;
    s.targets.actor.events.cue.dispatch = (p) => {
      original(p);
      if (p.label === "middle") s.player.pause();
    };
    const d = document();
    const clip = new SequenceClip({
      ...d,
      events: [
        ...d.events,
        { ...d.events[1], id: "middle2", payload: { label: "end" } },
      ],
    });
    s.player.play(clip, { targets: s.targets });
    s.player.advance(2);
    expect(s.player.frame).toBe(30);
    expect(s.events).toHaveLength(2);
    s.player.resume();
    s.player.advance(1);
    expect(s.events.map((e) => e.label)).toEqual([
      "start",
      "middle",
      "end",
      "end",
    ]);
  });
  it("cancel from an event preserves the event pose", () => {
    const s = setup();
    s.targets.actor.events.cue.dispatch = (p) => {
      if (p.label === "middle") s.player.cancel();
    };
    s.player.play(new SequenceClip(document()), { targets: s.targets });
    s.player.advance(2);
    expect(s.player.frame).toBe(30);
    expect(s.state.position.x).toBe(400);
  });
  it("rejects all missing bindings before changing any property", () => {
    const s = setup();
    const target = { ...s.targets.actor, events: {} };
    expect(() =>
      s.player.play(new SequenceClip(document()), {
        targets: { actor: target },
      }),
    ).toThrow("incompatible event");
    expect(s.state.rotation).toBe(7);
  });
  it("checks target lifetime before applying a pose", () => {
    const s = setup();
    s.player.play(new SequenceClip(document()), { targets: s.targets });
    s.state.alive = false;
    expect(() => s.player.advance(1)).toThrow("expired");
    expect(s.state.position.x).toBe(0);
  });
  it("attributes a throwing handler and does not continue", () => {
    const s = setup();
    s.targets.actor.events.cue.dispatch = (p) => {
      if (p.label === "middle") throw new Error("gesture failed");
    };
    s.player.play(new SequenceClip(document()), { targets: s.targets });
    expect(() => s.player.advance(2)).toThrow("gesture failed");
    expect(s.player.frame).toBe(30);
    expect(s.boundary.getCallbackErrors()[0]?.event).toBe("actor.cue");
  });
  it("captures the destination rectangle and rejects invalid advancement", () => {
    const s = setup();
    const frame = { x: 0, y: 0, width: 1600, height: 900 };
    s.player.play(new SequenceClip(document()), { targets: s.targets, frame });
    frame.width = 1;
    s.player.advance(1);
    expect(s.state.position.x).toBe(800);
    expect(() => s.player.advance(NaN)).toThrow("finite");
    expect(() =>
      s.player.play(new SequenceClip(document()), { targets: s.targets }),
    ).toThrow("active playback");
  });
});

describe("position inverse mapping", () => {
  for (const fit of ["stretch", "contain"] as const) {
    for (const mode of ["proportional", "anchored"] as const) {
      it(`round-trips ${mode} positions with ${fit}`, () => {
        const data = document();
        const clip = new SequenceClip({
          ...data,
          tracks: data.tracks.map((t) =>
            t.id !== "position"
              ? t
              : {
                  ...t,
                  position:
                    mode === "anchored"
                      ? { mode, anchor: { x: 0.8, y: 0.25 } }
                      : { mode },
                },
          ),
        });
        const options = {
          fit,
          frame: { x: 23, y: -17, width: 320, height: 700 },
        };
        const value = clip.sample(30, options)[0]!.value as {
          x: number;
          y: number;
        };
        expect(clip.unmapPosition("position", value, options)).toEqual({
          x: 400,
          y: 300,
        });
        expect(() => clip.unmapPosition("rotation", value, options)).toThrow(
          "position track",
        );
        expect(() =>
          clip.unmapPosition("position", { x: NaN, y: 0 }, options),
        ).toThrow();
      });
    }
  }
});

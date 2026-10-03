import { describe, it, expect } from "vitest";
import { ErrorBoundary, Logger, LogLevel } from "@yagejs/core";
import { SequenceClip } from "./evaluate.js";
import { SequencePlayer, sequenceProperty } from "./SequencePlayer.js";

const clip = (events = true) =>
  new SequenceClip({
    format: "yage-sequence",
    version: 1,
    name: "probe",
    fps: 1,
    duration: 10,
    frame: { width: 100, height: 100 },
    targets: {
      actor: {
        properties: { x: { kind: "number" }, y: { kind: "number" } },
        events: { cue: {} },
      },
    },
    tracks: ["x", "y"].map((property) => ({
      id: property,
      target: "actor",
      property,
      keys: [
        { id: `${property}0`, frame: 0, value: 0, curve: "linear" },
        { id: `${property}10`, frame: 10, value: 10, curve: "linear" },
      ],
    })),
    events: events
      ? [{ id: "cue5", target: "actor", event: "cue", frame: 5, payload: {} }]
      : [],
  });
const player = () =>
  new SequencePlayer(new ErrorBoundary(new Logger({ level: LogLevel.None })));

describe("binding lifetime and interruption", () => {
  it("checks a class target lifetime before any writes", () => {
    class Target {
      alive = false;
      x = 17;
      y = 18;
      properties = {
        x: sequenceProperty(
          { kind: "number" },
          () => this.x,
          (v) => {
            this.x = v;
          },
        ),
        y: sequenceProperty(
          { kind: "number" },
          () => this.y,
          (v) => {
            this.y = v;
          },
        ),
      };
      events = { cue: { payload: {}, dispatch() {} } };
      isAlive() {
        return this.alive;
      }
    }
    const target = new Target();
    expect(() => player().play(clip(), { targets: { actor: target } })).toThrow(
      "expired",
    );
    expect(target.x).toBe(17);
  });
  it("reads lifetime state from the original target receiver", () => {
    const p = player();
    let x = 17;
    const target = {
      alive: true,
      isAlive() {
        return this.alive;
      },
      properties: {
        x: sequenceProperty(
          { kind: "number" },
          () => x,
          (v) => {
            x = v;
          },
        ),
        y: sequenceProperty(
          { kind: "number" },
          () => 0,
          () => {},
        ),
      },
      events: { cue: { payload: {}, dispatch() {} } },
    };
    p.play(clip(), { targets: { actor: target } });
    target.alive = false;
    expect(() => p.advance(5)).toThrow("expired");
    expect(x).toBe(0);
  });
  it("stops remaining setters and markers when a setter cancels", () => {
    const p = player();
    const log: string[] = [];
    const target = {
      properties: {
        x: sequenceProperty(
          { kind: "number" },
          () => 17,
          (v) => {
            log.push(`x:${v}`);
            if (v === 5) p.cancel();
          },
        ),
        y: sequenceProperty(
          { kind: "number" },
          () => 18,
          (v) => {
            log.push(`y:${v}`);
          },
        ),
      },
      events: {
        cue: {
          payload: {},
          dispatch() {
            log.push("cue");
          },
        },
      },
    };
    p.play(clip(), { targets: { actor: target } });
    log.length = 0;
    p.advance(10);
    expect(p.state).toBe("cancelled");
    expect(log).toEqual(["x:5"]);
  });
  it("retains cancellation from the final pose", () => {
    const p = player();
    const log: string[] = [];
    const target = {
      properties: {
        x: sequenceProperty(
          { kind: "number" },
          () => 17,
          (v) => {
            log.push(`x:${v}`);
            if (v === 10) p.cancel();
          },
        ),
        y: sequenceProperty(
          { kind: "number" },
          () => 18,
          (v) => {
            log.push(`y:${v}`);
          },
        ),
      },
      events: { cue: { payload: {}, dispatch() {} } },
    };
    p.play(clip(false), { targets: { actor: target } });
    log.length = 0;
    p.advance(10);
    expect(p.state).toBe("cancelled");
    expect(log).toEqual(["x:10"]);
  });
});

it.each(["pause", "seek", "cancel-restore", "seek-cancel"] as const)(
  "honors %s from a property setter",
  (action) => {
    const p = player();
    const log: string[] = [];
    let interrupted = false;
    const target = {
      properties: {
        x: sequenceProperty(
          { kind: "number" },
          () => 17,
          (value) => {
            log.push(`x:${value}`);
            if (value !== 5 || interrupted) return;
            interrupted = true;
            if (action === "pause") p.pause();
            else if (action === "seek") p.seek(2);
            else if (action === "cancel-restore") p.cancel("restore");
            else p.cancel();
          },
        ),
        y: sequenceProperty(
          { kind: "number" },
          () => 18,
          (value) => {
            log.push(`y:${value}`);
          },
        ),
      },
      events: {
        cue: {
          payload: {},
          dispatch() {
            log.push("cue");
          },
        },
      },
    };
    p.play(clip(), { targets: { actor: target } });
    log.length = 0;
    if (action === "seek-cancel") p.seek(5);
    else p.advance(10);
    if (action === "pause") {
      expect(p.state).toBe("paused");
      expect(log).toEqual(["x:5"]);
      p.resume();
      p.advance(0);
      expect(log.filter((value) => value === "cue")).toHaveLength(1);
      expect(log.indexOf("y:5")).toBeLessThan(log.indexOf("cue"));
    } else if (action === "seek") {
      expect(p.state).toBe("playing");
      expect(p.frame).toBe(2);
      expect(log).toEqual(["x:5", "x:2", "y:2"]);
    } else {
      expect(p.state).toBe("cancelled");
      expect(log).toEqual(
        action === "cancel-restore" ? ["x:5", "x:17", "y:18"] : ["x:5"],
      );
    }
  },
);

it.each(["cancel", "finish"] as const)(
  "stops %s restoration when a saved-value setter requests a stop",
  (trigger) => {
    const p = player();
    const log: string[] = [];
    const target = {
      properties: {
        x: sequenceProperty(
          { kind: "number" },
          () => 17,
          (value) => {
            log.push(`x:${value}`);
            if (value === 17) {
              if (trigger === "cancel") p.cancel("retain");
              else p.pause();
            }
          },
        ),
        y: sequenceProperty(
          { kind: "number" },
          () => 18,
          (value) => {
            log.push(`y:${value}`);
          },
        ),
      },
      events: { cue: { payload: {}, dispatch() {} } },
    };
    p.play(clip(false), { targets: { actor: target }, finish: "restore" });
    log.length = 0;
    if (trigger === "cancel") p.cancel("restore");
    else p.advance(10);
    expect(log).toEqual(
      trigger === "cancel" ? ["x:17"] : ["x:10", "y:10", "x:17"],
    );
    expect(p.state).toBe(trigger === "cancel" ? "cancelled" : "paused");
  },
);

it("clears active callback tracking after restoration throws", () => {
  const p = player();
  const target = {
    properties: {
      x: sequenceProperty(
        { kind: "number" },
        () => 17,
        (value) => {
          if (value === 17) throw new Error("restore failed");
        },
      ),
      y: sequenceProperty(
        { kind: "number" },
        () => 18,
        () => {},
      ),
    },
    events: { cue: { payload: {}, dispatch() {} } },
  };
  p.play(clip(false), { targets: { actor: target } });
  expect(() => p.cancel("restore")).toThrow("restore failed");
  p.pause();
  expect(p.state).toBe("cancelled");
});

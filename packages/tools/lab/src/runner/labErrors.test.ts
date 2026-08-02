import type { CallbackErrorRecord } from "@yagejs/core";
import { describe, expect, it } from "vitest";
import { collectErrors, REBUILD_ERROR_KIND } from "./labErrors.js";

const record = (
  error: string,
  extra: Partial<CallbackErrorRecord> = {},
): CallbackErrorRecord => ({ kind: "Collision handler", error, ...extra });

const rebuild = (message: string) => ({
  kind: REBUILD_ERROR_KIND,
  message,
});

describe("collectErrors", () => {
  it("skips what was recorded before the mounted scene was built", () => {
    const old = record("old");
    const errors = collectErrors([], [old, record("new")], old);
    expect(errors.map((error) => error.message)).toEqual(["new"]);
  });

  it("joins scene, entity and event into the detail line", () => {
    const errors = collectErrors(
      [],
      [record("boom", { scene: "Drop", entity: "ball-0", event: "hit" })],
      null,
    );
    expect(errors[0]).toEqual({
      kind: "Collision handler",
      message: "boom",
      detail: "Drop · ball-0 · hit",
    });
  });

  it("leaves out the detail when the engine knew no context", () => {
    expect(
      collectErrors([], [record("boom")], null)[0]?.detail,
    ).toBeUndefined();
  });

  it("leads with the lab's own errors", () => {
    const errors = collectErrors(
      [rebuild("bad control")],
      [record("boom")],
      null,
    );
    expect(errors.map((error) => error.kind)).toEqual([
      REBUILD_ERROR_KIND,
      "Collision handler",
    ]);
  });

  it("drops its own error when the boundary attributed the same message", () => {
    const errors = collectErrors(
      [rebuild("boom")],
      [record("boom", { kind: "Scene onEnter", scene: "Drop" })],
      null,
    );
    expect(errors).toEqual([
      { kind: "Scene onEnter", message: "boom", detail: "Drop" },
    ]);
  });

  it("keeps its own error when only an older record shares the message", () => {
    const errors = collectErrors(
      [rebuild("boom")],
      [record("boom"), record("something else")],
      null,
    );
    expect(errors.map((error) => error.kind)).toEqual([
      REBUILD_ERROR_KIND,
      "Collision handler",
      "Collision handler",
    ]);
  });

  it("shows the whole log when the mark was dropped off the front", () => {
    const dropped = record("evicted");
    const errors = collectErrors([], [record("a"), record("b")], dropped);
    expect(errors.map((error) => error.message)).toEqual(["a", "b"]);
  });

  it("shows everything recorded when nothing was marked", () => {
    expect(collectErrors([], [record("a"), record("b")], null)).toHaveLength(2);
  });
});

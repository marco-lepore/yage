import { describe, expect, it } from "vitest";
import { DestroyFlushSystem } from "./DestroyFlushSystem.js";

describe("DestroyFlushSystem", () => {
  it("holds work through one whole frame before running it", () => {
    const queue = new DestroyFlushSystem();
    const ran: string[] = [];
    queue.add(() => ran.push("release"));

    // The frame the work was queued during. Its end-of-frame flush is the one
    // that takes the destroyed entities out, so the work cannot run yet.
    queue.update();
    expect(ran).toEqual([]);

    queue.update();
    expect(ran).toEqual(["release"]);
  });

  it("runs each piece of work once", () => {
    const queue = new DestroyFlushSystem();
    const ran: string[] = [];
    queue.add(() => ran.push("first"));

    queue.update();
    queue.update();
    queue.update();
    queue.update();

    expect(ran).toEqual(["first"]);
  });

  it("keeps work queued in a later frame waiting its own frame out", () => {
    const queue = new DestroyFlushSystem();
    const ran: string[] = [];

    queue.add(() => ran.push("first"));
    queue.update();
    queue.add(() => ran.push("second"));
    queue.update();
    expect(ran).toEqual(["first"]);

    queue.update();
    expect(ran).toEqual(["first", "second"]);
  });
});

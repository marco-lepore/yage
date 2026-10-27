import { describe, it, expect, expectTypeOf } from "vitest";
import type { EngineEvents } from "./EventBus.js";

// Type-level coverage for the engine event payloads a plugin outside core
// emits: the renderer publishes the graphics-context event, so its payload
// shape is pinned here. The assertions compile; `assertTypes` is never
// called, and the runtime test below only asserts that.

function assertTypes(): void {
  expectTypeOf<EngineEvents["graphics:context"]>().toEqualTypeOf<{
    lost: boolean;
  }>();
}

describe("EngineEvents types", () => {
  it("compiles its type assertions", () => {
    expect(typeof assertTypes).toBe("function");
  });
});

import { describe, it, expect } from "vitest";
import { PhysicsWorldKey } from "./types.js";

describe("Service Keys", () => {
  it("PhysicsWorldKey has id 'physicsWorld'", () => {
    expect(PhysicsWorldKey.id).toBe("physicsWorld");
  });
});

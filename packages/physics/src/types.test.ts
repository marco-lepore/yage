import { describe, it, expect } from "vitest";
import { PhysicsWorldManagerKey } from "./types.js";

describe("Service Keys", () => {
  it("PhysicsWorldManagerKey has id 'physicsWorldManager'", () => {
    expect(PhysicsWorldManagerKey.id).toBe("physicsWorldManager");
  });
});

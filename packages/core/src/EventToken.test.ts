import { describe, it, expect } from "vitest";
import { EventToken, defineEvent } from "./EventToken.js";

describe("EventToken", () => {
  it("stores the event name", () => {
    const token = new EventToken("hit");
    expect(token.name).toBe("hit");
  });

  it("defineEvent creates a token", () => {
    const token = defineEvent("damage");
    expect(token).toBeInstanceOf(EventToken);
    expect(token.name).toBe("damage");
  });

  it("defineEvent with type parameter creates a token", () => {
    const token = defineEvent<{ amount: number }>("damage");
    expect(token.name).toBe("damage");
  });

  it("void event token has no type requirement", () => {
    const token = defineEvent("ping");
    expect(token.name).toBe("ping");
  });
});

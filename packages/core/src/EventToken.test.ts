import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
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
    const token = defineEvent<{ amount: number }>("damage:typed");
    expect(token.name).toBe("damage:typed");
  });

  it("void event token has no type requirement", () => {
    const token = defineEvent("ping");
    expect(token.name).toBe("ping");
  });

  it("rejects an empty name", () => {
    expect(() => defineEvent("")).toThrow(
      'defineEvent: name must be a non-empty string, got "".',
    );
  });

  it("rejects a non-string name", () => {
    expect(() => defineEvent(undefined as unknown as string)).toThrow(
      "defineEvent: name must be a non-empty string, got undefined.",
    );
  });

  describe("duplicate names", () => {
    const original = process.env.NODE_ENV;
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      warn.mockRestore();
      process.env.NODE_ENV = original;
    });

    it("warns in dev on the second definition of a name, not the first", () => {
      process.env.NODE_ENV = "development";
      defineEvent("dup:dev");
      expect(warn).not.toHaveBeenCalled();

      defineEvent("dup:dev");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain('defineEvent("dup:dev")');

      defineEvent("dup:dev");
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it("stays silent in production", () => {
      process.env.NODE_ENV = "production";
      defineEvent("dup:prod");
      defineEvent("dup:prod");
      expect(warn).not.toHaveBeenCalled();
    });
  });
});

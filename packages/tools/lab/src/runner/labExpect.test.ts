import { expect as vitestExpect, it } from "vitest";
import { expect } from "./labExpect.js";

it("keeps a long compared value whole in a failed assertion", () => {
  const value = JSON.stringify({ players: "player-state-".repeat(8) });
  let message = "";

  try {
    expect(value).toBe("nope");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  vitestExpect(message).toContain(value);
  vitestExpect(message).not.toContain("…");
});

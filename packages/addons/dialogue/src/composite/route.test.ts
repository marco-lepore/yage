import { describe, expect, it } from "vitest";

import { routeWithActor, makeDefaultRoute, fixedRoute, choiceAsLine } from "./route.js";
import type { PresentedLine, SpeakerView } from "../core/session.js";

/**
 * Speaker-based routing. The default route's precedence is a pure function of
 * the line + an actor lookup (so it needs no scene here):
 *   narrator → box; explicit `view` wins for a speaker; else registered actor →
 *   bubble, otherwise box. A game overrides the policy in ONE place.
 */

const npc: SpeakerView = { id: "npc", name: "NPC" };
const line = (over: Partial<PresentedLine> = {}): PresentedLine => ({
  text: { runs: [], tokens: [], length: 0 },
  speed: 1,
  ...over,
});

const hasActor = (...registered: string[]): ((id: string) => boolean) => {
  const set = new Set(registered);
  return (id) => set.has(id);
};

describe("routeWithActor — default precedence", () => {
  const none = hasActor();

  it("narrator (no speaker) → box, even with view:'bubble'", () => {
    expect(routeWithActor(line(), none)).toBe("box");
    expect(routeWithActor(line({ view: "bubble" }), none)).toBe("box");
    expect(routeWithActor(undefined, none)).toBe("box");
  });

  it("explicit view wins for a real speaker", () => {
    expect(routeWithActor(line({ speaker: npc, view: "bubble" }), none)).toBe("bubble");
    // view:'bubble' wins even when the actor is missing (renders at the fallback
    // anchor rather than vanishing).
    expect(routeWithActor(line({ speaker: npc, view: "box" }), hasActor("npc"))).toBe("box");
  });

  it("no view → a registered actor floats in a bubble; an unregistered one stays in the box", () => {
    expect(routeWithActor(line({ speaker: npc }), hasActor("npc"))).toBe("bubble");
    expect(routeWithActor(line({ speaker: npc }), none)).toBe("box");
  });
});

describe("makeDefaultRoute — scene binding", () => {
  it("answers 'no actor' before bind (narrator/view rules still apply)", () => {
    const r = makeDefaultRoute();
    expect(r.route(line({ speaker: npc }))).toBe("box"); // no actor lookup yet
    expect(r.route(line({ speaker: npc, view: "bubble" }))).toBe("bubble"); // view wins
  });
});

describe("fixedRoute — one-place override", () => {
  it("routes by a custom policy and ignores the scene", () => {
    // "All of the boss's lines in bubbles, everything else in the box."
    const r = fixedRoute((l) => (l?.speaker?.id === "boss" ? "bubble" : "box"));
    expect(r.route(line({ speaker: { id: "boss", name: "Boss" } }))).toBe("bubble");
    expect(r.route(line({ speaker: npc, view: "bubble" }))).toBe("box"); // override beats view
    r.bind({} as never); // no-op; never throws
    expect(r.route(line({ speaker: { id: "boss", name: "Boss" } }))).toBe("bubble");
  });
});

describe("choiceAsLine — a choice routes like its prompt line", () => {
  it("carries view + speaker so the same route applies", () => {
    const asLine = choiceAsLine({ view: "bubble", speaker: npc });
    expect(routeWithActor(asLine, hasActor("npc"))).toBe("bubble");
    expect(choiceAsLine(undefined).speaker).toBeUndefined();
  });
});

import { expect, test, type Page } from "@playwright/test";
import { getComponentData, gotoFixture, stepFrames, waitForClock } from "./helpers";

interface ProbeData {
  hp: number;
  maxHp: number;
  dead: boolean;
  damagedCount: number;
  healedCount: number;
  guardedCount: number;
  lastGuardOutcome: string;
  mainActive: string | null;
  itemActive: string | null;
  staggered: boolean;
  x: number;
  y: number;
}

type Who = "player" | "enemy";
type StatKind = "atk" | "def" | "maxHp" | "atkSpeed";

interface HostHandle {
  play(who: Who, id: string): boolean;
  teleport(who: Who, x: number, y: number): void;
  setStat(who: Who, kind: StatKind, value: number): void;
  cooldownRemaining(who: Who, id: string): number;
}

function probe(page: Page, who: Who): Promise<ProbeData | undefined> {
  return getComponentData<ProbeData>(
    page,
    who === "player" ? "PlayerEntity" : "EnemyEntity",
    "CombatProbe",
  );
}

async function play(page: Page, who: Who, id: string): Promise<boolean> {
  return page.evaluate(
    ({ who: w, id: abilityId }) =>
      (window as unknown as { __abilities__: HostHandle }).__abilities__.play(
        w,
        abilityId,
      ),
    { who, id },
  );
}

async function teleport(page: Page, who: Who, x: number, y: number): Promise<void> {
  await page.evaluate(
    ({ who: w, x: px, y: py }) =>
      (window as unknown as { __abilities__: HostHandle }).__abilities__.teleport(
        w,
        px,
        py,
      ),
    { who, x, y },
  );
}

async function setStat(
  page: Page,
  who: Who,
  kind: StatKind,
  value: number,
): Promise<void> {
  await page.evaluate(
    ({ who: w, kind: k, value: v }) =>
      (window as unknown as { __abilities__: HostHandle }).__abilities__.setStat(w, k, v),
    { who, kind, value },
  );
}

async function cooldownRemaining(page: Page, who: Who, id: string): Promise<number> {
  return page.evaluate(
    ({ who: w, id: abilityId }) =>
      (
        window as unknown as { __abilities__: HostHandle }
      ).__abilities__.cooldownRemaining(w, abilityId),
    { who, id },
  );
}

test.describe("@yagejs-addons/abilities addon", () => {
  test("a slash hitbox lands on an adjacent enemy", async ({ page }) => {
    await gotoFixture(page, "/abilities-addon.html");
    await waitForClock(page);

    // Player at its spawn (80,150), facing default +x; put the enemy right
    // in front, inside the hitbox's reach (offset 26, capsule reach ~25).
    await teleport(page, "enemy", 130, 150);
    await stepFrames(page, 2);

    expect(await play(page, "player", "slash")).toBe(true);
    // The hitbox window is [0.05, 0.16]s — well under a second of frames.
    await stepFrames(page, 20);

    const enemy = await probe(page, "enemy");
    expect(enemy?.damagedCount).toBe(1);
    expect(enemy?.hp).toBe(32); // 50 max - 18 slash damage
  });

  test("an enemy's touch damage lands on an undefended player", async ({ page }) => {
    await gotoFixture(page, "/abilities-addon.html");
    await waitForClock(page);

    // Move the enemy into contact range (radii 14+14=28) of the player's spawn.
    await teleport(page, "enemy", 80 + 26, 150);
    await stepFrames(page, 5);

    const player = await probe(page, "player");
    expect(player?.damagedCount).toBe(1);
    expect(player?.hp).toBe(94); // 100 max - 6 touch damage
    expect(player?.staggered).toBe(true); // stun:0.25 forces the stagger reaction
  });

  test("an active guard negates a touch hit and punishes the attacker", async ({
    page,
  }) => {
    await gotoFixture(page, "/abilities-addon.html");
    await waitForClock(page);

    // Arm the guard before the enemy ever makes contact, so the very first
    // touch-damage delivery meets an open guard window (to: 0.6s, plenty of
    // margin over the few frames this takes).
    expect(await play(page, "player", "guard")).toBe(true);
    await stepFrames(page, 3);

    await teleport(page, "enemy", 80 + 26, 150);
    await stepFrames(page, 5);

    const player = await probe(page, "player");
    expect(player?.damagedCount).toBe(0); // the touch never landed as damage
    expect(player?.guardedCount).toBe(1);
    expect(player?.lastGuardOutcome).toBe("parried");

    // The guard's punish (damage:10) is delivered back to the attacker.
    const enemy = await probe(page, "enemy");
    expect(enemy?.hp).toBe(40); // 50 max - 10 punish damage
  });

  test("dash's invulnerable window blocks a touch it dashes into, and closes on schedule", async ({
    page,
  }) => {
    await gotoFixture(page, "/abilities-addon.html");
    await waitForClock(page);

    // Enemy sits ahead of the player's default (+x) facing, out of touch
    // range; dashing (speed 560 for 0.18s) carries the player into contact
    // while `invulnerable` is still open.
    await teleport(page, "enemy", 80 + 90, 150);
    await stepFrames(page, 2);

    expect(await play(page, "player", "dash")).toBe(true);
    await stepFrames(page, 20); // > 0.18s dash window, contact begins mid-dash

    const after = await probe(page, "player");
    expect(after?.damagedCount).toBe(0); // the contact mid-dash was ignored
    expect(after?.mainActive).toBeNull(); // the window closed on schedule
  });

  test("the potion heals on the item lane while the main lane is busy with a forced stagger", async ({
    page,
  }) => {
    await gotoFixture(page, "/abilities-addon.html");
    await waitForClock(page);

    // Let an undefended touch damage + stun the player onto the main lane.
    await teleport(page, "enemy", 80 + 26, 150);
    await stepFrames(page, 5);

    const stunned = await probe(page, "player");
    expect(stunned?.mainActive).toBe("stagger");
    expect(stunned?.hp).toBe(94);

    // The item lane is independent of the busy main lane: `play` succeeds
    // (would be refused on the main lane, which is occupied by the
    // priority-100 stagger reaction) even though the player is still
    // stunned. The potion's single `heal` point step fires and completes
    // within a frame or two, well inside the stagger's 0.25s window.
    expect(await play(page, "player", "potion")).toBe(true);
    await stepFrames(page, 3);

    const healed = await probe(page, "player");
    expect(healed?.mainActive).toBe("stagger"); // still staggered — lanes are independent
    expect(healed?.healedCount).toBe(1);
    expect(healed?.hp).toBe(100); // healed back to max (30 requested, clamped)
  });

  test("an enemy projectile travels to the player and lands", async ({ page }) => {
    await gotoFixture(page, "/abilities-addon.html");
    await waitForClock(page);

    // Default spawns: enemy (320,150), player (80,150) — 240px apart. The
    // projectile's `aim` resolver targets the player's live position.
    expect(await play(page, "enemy", "shoot")).toBe(true);

    // speed 240px/s, contact at gap = radii sum (5 + 14 = 19), so travel
    // 240 - 19 = 221px ≈ 0.92s ≈ 55 frames; step comfortably past that
    // while staying well under the projectile's 2.5s lifetime.
    await stepFrames(page, 90);

    const player = await probe(page, "player");
    expect(player?.damagedCount).toBe(1);
    expect(player?.hp).toBe(90); // 100 max - 10 projectile damage
  });
});

// The four numeric boundary hooks the stats slice wires up, each
// exercised by mutating a game-side stat at runtime and observing the addon
// side. Both combatants start neutral (atk=BASE_ATK, def=0, atkSpeed=1), so
// the tests above see unchanged baseline numbers.
test.describe("@yagejs-addons/abilities stats boundary", () => {
  test("atk scales attack damage through the fire-time hit builder", async ({
    page,
  }) => {
    await gotoFixture(page, "/abilities-addon.html");
    await waitForClock(page);

    // Double the player's attack stat before the swing fires.
    await setStat(page, "player", "atk", 20);
    await teleport(page, "enemy", 130, 150);
    await stepFrames(page, 2);

    expect(await play(page, "player", "slash")).toBe(true);
    await stepFrames(page, 20);

    const enemy = await probe(page, "enemy");
    expect(enemy?.hp).toBe(14); // 50 max - (18 * 20/10 = 36) scaled damage
  });

  test("def reduces incoming damage through the game-authored fold stage", async ({
    page,
  }) => {
    await gotoFixture(page, "/abilities-addon.html");
    await waitForClock(page);

    // Give the enemy 5 armor; the slash's 18 damage should arrive as 13.
    await setStat(page, "enemy", "def", 5);
    await teleport(page, "enemy", 130, 150);
    await stepFrames(page, 2);

    expect(await play(page, "player", "slash")).toBe(true);
    await stepFrames(page, 20);

    const enemy = await probe(page, "enemy");
    expect(enemy?.hp).toBe(37); // 50 max - (18 - 5 armor = 13)
  });

  test("maxHp pushes into Health.max and heals the gained headroom", async ({
    page,
  }) => {
    await gotoFixture(page, "/abilities-addon.html");
    await waitForClock(page);

    await setStat(page, "player", "maxHp", 150);

    const player = await probe(page, "player");
    expect(player?.maxHp).toBe(150); // the raised cap
    expect(player?.hp).toBe(150); // full: 100 + the 50 gained headroom healed in
  });

  test("atkSpeed shrinks a Scalar cooldown, re-resolved per activation", async ({
    page,
  }) => {
    await gotoFixture(page, "/abilities-addon.html");
    await waitForClock(page);

    // Default attack speed: dash's 1.0s cooldown arms in full.
    expect(await play(page, "player", "dash")).toBe(true);
    expect(await cooldownRemaining(page, "player", "dash")).toBeCloseTo(1.0, 2);

    // Let the dash and its cooldown finish, then double attack speed. The next
    // activation re-resolves the Scalar, so the same def arms a 0.5s cooldown.
    await stepFrames(page, 75);
    await setStat(page, "player", "atkSpeed", 2);
    expect(await play(page, "player", "dash")).toBe(true);
    expect(await cooldownRemaining(page, "player", "dash")).toBeCloseTo(0.5, 2);
  });
});

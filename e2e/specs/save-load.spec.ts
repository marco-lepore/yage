import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { gotoFixture } from "./helpers";

// Helper: find an entity by class name in the active scene
function findEntity(page: Page, className: string) {
  return page.evaluate((cls) => {
    const scene = (window as any).__yage__!.inspector["engine"].scenes.active;
    for (const entity of scene.getEntities()) {
      if (entity.constructor.name === cls) return entity;
    }
    return null;
  }, className);
}

// Helper: wait until the active scene has at least N entities
function waitForEntities(page: Page, count: number) {
  return page.waitForFunction(
    (n) => window.__yage__?.inspector.getEntities().length >= n,
    count,
  );
}

test.describe("Save/Load system", () => {
  test.beforeEach(async ({ page }) => {
    await gotoFixture(page, "/save-load.html");
    await waitForEntities(page, 3);
  });

  test("entities are present after initial scene load", async ({ page }) => {
    const entities = await page.evaluate(() =>
      window.__yage__!.inspector
        .getEntities()
        .map((e: any) => e.name),
    );
    // We have at least Player, Hat, Companion
    expect(entities.length).toBeGreaterThanOrEqual(3);

    const componentNames = await page.evaluate(() => {
      const scene = (window as any).__yage__!.inspector["engine"].scenes.active;
      for (const entity of scene.getEntities()) {
        if (entity.constructor.name === "Player") {
          return [...entity.getAll()].map((c: any) => c.constructor.name);
        }
      }
      return [];
    });
    expect(componentNames).toContain("Transform");
    expect(componentNames).toContain("ScoreTracker");
  });

  test("save and load restores entity positions", async ({ page }) => {
    // Move player to a new position
    await page.evaluate(() => {
      const scene = (window as any).__yage__!.inspector["engine"].scenes.active;
      for (const entity of scene.getEntities()) {
        if (entity.constructor.name === "Player") {
          for (const comp of entity.getAll()) {
            if (comp.constructor.name === "Transform") {
              comp.setPosition(300, 150);
              break;
            }
          }
          break;
        }
      }
    });

    // Save → Load
    await page.evaluate(() => (window as any).__saveService__.saveSnapshot("e2e"));
    await page.evaluate(() => (window as any).__saveService__.loadSnapshot("e2e"));
    await waitForEntities(page, 3);

    // Verify player position was restored
    const pos = await page.evaluate(() => {
      const scene = (window as any).__yage__!.inspector["engine"].scenes.active;
      for (const entity of scene.getEntities()) {
        if (entity.constructor.name === "Player") {
          for (const comp of entity.getAll()) {
            if (comp.constructor.name === "Transform") {
              return { x: comp.position.x, y: comp.position.y };
            }
          }
        }
      }
      return null;
    });
    expect(pos).toBeDefined();
    expect(pos!.x).toBeCloseTo(300, 0);
    expect(pos!.y).toBeCloseTo(150, 0);
  });

  test("save and load restores component state", async ({ page }) => {
    // Set score on ScoreTracker
    await page.evaluate(() => {
      const scene = (window as any).__yage__!.inspector["engine"].scenes.active;
      for (const entity of scene.getEntities()) {
        if (entity.constructor.name === "Player") {
          for (const comp of entity.getAll()) {
            if (comp.constructor.name === "ScoreTracker") {
              comp.score = 42;
              break;
            }
          }
          break;
        }
      }
    });

    await page.evaluate(() => (window as any).__saveService__.saveSnapshot("e2e"));
    await page.evaluate(() => (window as any).__saveService__.loadSnapshot("e2e"));
    await waitForEntities(page, 3);

    const score = await page.evaluate(() => {
      const scene = (window as any).__yage__!.inspector["engine"].scenes.active;
      for (const entity of scene.getEntities()) {
        if (entity.constructor.name === "Player") {
          for (const comp of entity.getAll()) {
            if (comp.constructor.name === "ScoreTracker") {
              return comp.score;
            }
          }
        }
      }
      return null;
    });
    expect(score).toBe(42);
  });

  test("save and load restores parent/child relationships", async ({ page }) => {
    // Verify initial parent/child
    const initialParent = await page.evaluate(() => {
      const scene = (window as any).__yage__!.inspector["engine"].scenes.active;
      for (const entity of scene.getEntities()) {
        if (entity.constructor.name === "Hat") {
          return entity.parent?.constructor.name ?? null;
        }
      }
      return null;
    });
    expect(initialParent).toBe("Player");

    // Save → Load
    await page.evaluate(() => (window as any).__saveService__.saveSnapshot("e2e"));
    await page.evaluate(() => (window as any).__saveService__.loadSnapshot("e2e"));
    await waitForEntities(page, 3);

    // Verify parent/child survived
    const restored = await page.evaluate(() => {
      const scene = (window as any).__yage__!.inspector["engine"].scenes.active;
      for (const entity of scene.getEntities()) {
        if (entity.constructor.name === "Hat") {
          const parent = entity.parent;
          if (!parent) return { hasParent: false, parentType: null, childName: null };
          let childName: string | null = null;
          for (const [name, child] of parent.children) {
            if (child === entity) { childName = name; break; }
          }
          return {
            hasParent: true,
            parentType: parent.constructor.name,
            childName,
          };
        }
      }
      return null;
    });

    expect(restored).toBeDefined();
    expect(restored!.hasParent).toBe(true);
    expect(restored!.parentType).toBe("Player");
    expect(restored!.childName).toBe("hat");
  });

  test("save and load preserves Transform hierarchy (world position)", async ({ page }) => {
    // Get Hat's world position before save
    const worldBefore = await page.evaluate(() => {
      const scene = (window as any).__yage__!.inspector["engine"].scenes.active;
      for (const entity of scene.getEntities()) {
        if (entity.constructor.name === "Hat") {
          for (const comp of entity.getAll()) {
            if (comp.constructor.name === "Transform") {
              const wp = comp.worldPosition;
              return { x: wp.x, y: wp.y };
            }
          }
        }
      }
      return null;
    });
    expect(worldBefore).toBeDefined();
    // player(100, 200) + hat(0, -16)
    expect(worldBefore!.x).toBeCloseTo(100, 0);
    expect(worldBefore!.y).toBeCloseTo(184, 0);

    await page.evaluate(() => (window as any).__saveService__.saveSnapshot("e2e"));
    await page.evaluate(() => (window as any).__saveService__.loadSnapshot("e2e"));
    await waitForEntities(page, 3);

    const worldAfter = await page.evaluate(() => {
      const scene = (window as any).__yage__!.inspector["engine"].scenes.active;
      for (const entity of scene.getEntities()) {
        if (entity.constructor.name === "Hat") {
          for (const comp of entity.getAll()) {
            if (comp.constructor.name === "Transform") {
              const wp = comp.worldPosition;
              return { x: wp.x, y: wp.y };
            }
          }
        }
      }
      return null;
    });

    expect(worldAfter).toBeDefined();
    expect(worldAfter!.x).toBeCloseTo(worldBefore!.x, 0);
    expect(worldAfter!.y).toBeCloseTo(worldBefore!.y, 0);
  });

  test("SnapshotResolver resolves entity references after load", async ({ page }) => {
    await page.evaluate(() => (window as any).__saveService__.saveSnapshot("e2e"));
    await page.evaluate(() => (window as any).__saveService__.loadSnapshot("e2e"));
    await waitForEntities(page, 3);

    const resolved = await page.evaluate(() => {
      const scene = (window as any).__yage__!.inspector["engine"].scenes.active;
      for (const entity of scene.getEntities()) {
        if (entity.constructor.name === "Companion") {
          return {
            hasLeader: entity.resolvedLeader !== null,
            leaderType: entity.resolvedLeader?.constructor.name ?? null,
          };
        }
      }
      return null;
    });

    expect(resolved).toBeDefined();
    expect(resolved!.hasLeader).toBe(true);
    expect(resolved!.leaderType).toBe("Player");
  });

  test("saveData/loadData round-trips user data", async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__saveService__.saveData("profile", {
        bestScore: 99,
        name: "tester",
      });
    });

    const loaded = await page.evaluate(() =>
      (window as any).__saveService__.loadData("profile"),
    );
    expect(loaded).toEqual({ bestScore: 99, name: "tester" });
  });

  test("deleteSnapshot removes saved snapshot", async ({ page }) => {
    await page.evaluate(() => (window as any).__saveService__.saveSnapshot("temp"));
    const before = await page.evaluate(() =>
      (window as any).__saveService__.hasSnapshot("temp"),
    );
    expect(before).toBe(true);

    await page.evaluate(() =>
      (window as any).__saveService__.deleteSnapshot("temp"),
    );
    const after = await page.evaluate(() =>
      (window as any).__saveService__.hasSnapshot("temp"),
    );
    expect(after).toBe(false);
  });

  test("loadSnapshot throws on missing slot", async ({ page }) => {
    const error = await page.evaluate(async () => {
      try {
        await (window as any).__saveService__.loadSnapshot("nonexistent");
        return null;
      } catch (e: any) {
        return e.message;
      }
    });
    expect(error).toContain("No save found");
  });
});

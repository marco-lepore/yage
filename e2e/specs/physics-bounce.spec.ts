import { expect, test } from "@playwright/test";
import {
  getComponentData,
  getEntityByName,
  getEntityPosition,
  gotoFixture,
} from "./helpers";

interface BounceCounterData {
  count: number;
}

test.describe("Physics bounce fixture", () => {
  test("ball falls and registers bounce events", async ({ page }) => {
    await gotoFixture(page, "/physics-bounce.html");

    const ball = await getEntityByName(page, "ball");
    expect(ball).toBeDefined();
    expect(ball?.components).toEqual(
      expect.arrayContaining([
        "Transform",
        "RigidBodyComponent",
        "ColliderComponent",
        "BounceCounter",
      ]),
    );

    const initialPosition = await getEntityPosition(page, "ball");
    expect(initialPosition).toBeDefined();

    await page.waitForTimeout(300);

    const fallingPosition = await getEntityPosition(page, "ball");
    expect(fallingPosition).toBeDefined();
    expect(fallingPosition!.y).toBeGreaterThan(initialPosition!.y);

    await page.waitForFunction(() => {
      const data = window.__yage__?.inspector.getComponentData(
        "ball",
        "BounceCounter",
      ) as
        | {
            count?: number;
          }
        | undefined;
      return (data?.count ?? 0) >= 1;
    });

    const bounceData = await getComponentData<BounceCounterData>(
      page,
      "ball",
      "BounceCounter",
    );
    expect(bounceData).toBeDefined();
    expect(bounceData!.count).toBeGreaterThanOrEqual(1);
  });
});

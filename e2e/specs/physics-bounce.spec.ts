import { expect, test } from "@playwright/test";
import {
  getComponentData,
  getEntityByName,
  getEntityPosition,
  gotoFixture,
  stepFrames,
  waitForClock,
} from "./helpers";

interface BounceCounterData {
  count: number;
}

test.describe("Physics bounce fixture", () => {
  test("ball falls and registers bounce events", async ({ page }) => {
    await gotoFixture(page, "/physics-bounce.html");
    await waitForClock(page);

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

    await stepFrames(page, 12);

    const fallingPosition = await getEntityPosition(page, "ball");
    expect(fallingPosition).toBeDefined();
    expect(fallingPosition!.y).toBeGreaterThan(initialPosition!.y);

    await stepFrames(page, 180);

    const bounceData = await getComponentData<BounceCounterData>(
      page,
      "ball",
      "BounceCounter",
    );
    expect(bounceData).toBeDefined();
    expect(bounceData!.count).toBeGreaterThanOrEqual(1);
  });
});

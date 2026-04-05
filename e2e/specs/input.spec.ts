import { expect, test } from "@playwright/test";
import { getComponentData, gotoFixture, stepFrames, waitForClock } from "./helpers";

interface InputProbeData {
  jumpPressed: boolean;
  jumpJustPressed: boolean;
  jumpJustReleased: boolean;
}

test.describe("Input fixture", () => {
  test("tracks keyboard pressed and edge-triggered state across exact frames", async ({
    page,
  }) => {
    await gotoFixture(page, "/input.html");
    await waitForClock(page);

    const initial = await getComponentData<InputProbeData>(
      page,
      "input-display",
      "InputProbe",
    );
    expect(initial).toMatchObject({
      jumpPressed: false,
      jumpJustPressed: false,
      jumpJustReleased: false,
    });

    await page.keyboard.down("Space");
    await stepFrames(page, 1);

    const pressed = await getComponentData<InputProbeData>(
      page,
      "input-display",
      "InputProbe",
    );
    expect(pressed).toMatchObject({
      jumpPressed: true,
      jumpJustPressed: true,
      jumpJustReleased: false,
    });

    await stepFrames(page, 1);

    const held = await getComponentData<InputProbeData>(
      page,
      "input-display",
      "InputProbe",
    );
    expect(held).toMatchObject({
      jumpPressed: true,
      jumpJustPressed: false,
      jumpJustReleased: false,
    });

    await page.keyboard.up("Space");
    await stepFrames(page, 1);

    const released = await getComponentData<InputProbeData>(
      page,
      "input-display",
      "InputProbe",
    );
    expect(released).toMatchObject({
      jumpPressed: false,
      jumpJustPressed: false,
      jumpJustReleased: true,
    });
  });
});

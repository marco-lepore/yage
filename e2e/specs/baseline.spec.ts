import { chromium, expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { gotoFixture } from "./helpers.js";
import {
  CASE_NAMES,
  openBaseline,
  read,
  readCase,
  readLighting,
  readPixels,
  waitForSettled,
} from "./baseline-probe.js";
import type { BaselineExtension, BaselinePixel } from "./baseline-probe.js";

test.describe("baseline fixture", () => {
  test("mounts every case and reports the browser host", async ({ page }) => {
    await openBaseline(page);
    await waitForSettled(page);
    const reading = await read(page);
    expect(reading.cases).toEqual(CASE_NAMES);
    expect(reading.settledCases).toEqual(CASE_NAMES);
    expect(reading.target).toBe("web");
    expect(reading.profile).toBe("test");
    expect(reading.errors.callbackErrors).toEqual([]);
    expect(reading.host.info.runtime).toBe("browser");
    expect(reading.host.info.os).toBe("unknown");
    expect(reading.policy.stringEvaluation).toBe(true);
  });

  test("sprites: the texture loaded at its own size", async ({ page }) => {
    const reading = await readCase(page, "sprites");
    expect(reading["textureWidth"]).toBeGreaterThan(0);
    expect(reading["textureHeight"]).toBeGreaterThan(0);
    expect(reading["visible"]).toBe(true);
  });

  test("text-ui: the panel is laid out at its declared width", async ({
    page,
  }) => {
    const reading = await readCase(page, "text-ui");
    expect(reading["textWidth"]).toBeGreaterThan(0);
    expect(reading["panelWidth"]).toBe(200);
    expect(reading["panelHeight"]).toBeGreaterThan(20);
  });

  test("masks: the sprite keeps its mask", async ({ page }) => {
    const reading = await readCase(page, "masks");
    expect(reading["maskAttached"]).toBe(true);
  });

  test("render-targets: the buffer drew at its own size", async ({ page }) => {
    const reading = await readCase(page, "render-targets");
    expect(reading["width"]).toBe(128);
    expect(reading["height"]).toBe(64);
    expect(reading["resolution"]).toBe(reading["rendererResolution"]);
  });

  test("effects: both effects stay attached", async ({ page }) => {
    const reading = await readCase(page, "effects");
    expect(reading["effects"]).toEqual(["yage:outline", "baseline:tint"]);
  });

  test("lighting: the lamp lights its own position", async ({ page }) => {
    const reading = await readCase(page, "lighting");
    expect(reading["levelAtLight"]).toBeGreaterThan(
      reading["levelFar"] as number,
    );
  });

  test("physics: the ball falls and lands", async ({ page }) => {
    const reading = await readCase(page, "physics");
    expect(reading["y"]).toBeGreaterThan(reading["startY"] as number);
    expect(reading["contacts"]).toBeGreaterThanOrEqual(1);
  });

  test("workers: the worker answered", async ({ page }) => {
    const reading = await readCase(page, "workers");
    expect(reading["reply"]).toBe(42);
  });

  test("audio: the registered sound is accepted for playback", async ({
    page,
  }) => {
    const reading = await readCase(page, "audio");
    expect(reading["played"]).toBe(true);
    expect(reading["refusal"]).toBeNull();
  });

  test("input: nothing is pressed before a driver presses it", async ({
    page,
  }) => {
    const reading = await readCase(page, "input");
    expect(reading["jumpPresses"]).toBe(0);
    expect(reading["lastPointer"]).toBeNull();
  });

  test("saves: a fresh profile starts at zero", async ({ page }) => {
    const reading = await readCase(page, "saves");
    expect(reading["launchesBefore"]).toBe(0);
    expect(reading["launchesAfter"]).toBe(1);
    expect(reading["slotBefore"]).toBeNull();
    expect(reading["slotAfter"]).toBe(1);
    expect(reading["failure"]).toBeNull();
  });

  test("lifecycle: an open page is active and unpaused", async ({ page }) => {
    const reading = await readCase(page, "lifecycle");
    expect(reading["active"]).toBe(true);
    expect(reading["activeChanges"]).toEqual([]);
    expect(reading["pausedNow"]).toBe(false);
  });

  test("display: the renderer reports the screen and the context it drew on", async ({
    page,
  }) => {
    const reading = await readCase(page, "display");
    expect(reading["fullscreenSupport"]).toBe("supported");
    expect(reading["isFullscreen"]).toBe(false);
    expect(reading["orientation"]).toBe("landscape-primary");
    expect(reading["orientationLockSupport"]).toBe("unknown");
    expect(reading["contextLost"]).toBe(false);
    const graphics = reading["graphics"] as Record<string, unknown>;
    expect(graphics["backend"]).toBe("webgl2");
    expect(graphics["blendMinMax"]).toBe("supported");
    expect(Number.isInteger(graphics["maxTextureSize"])).toBe(true);
    expect(graphics["maxTextureSize"]).toBeGreaterThan(0);
  });

  test("an unknown case name stops the start", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/baseline.html?case=nope");
    await expect.poll(() => errors.length).toBeGreaterThan(0);
    expect(errors[0]).toBe(
      'Baseline: unknown case "nope". Known cases: ' +
        `${CASE_NAMES.join(", ")}.`,
    );
    expect(await page.evaluate(() => window.__yage__ === undefined)).toBe(true);
  });

  test("the Capacitor entry says what a browser page is missing", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/baseline-capacitor.html");
    await expect.poll(() => errors.length).toBeGreaterThan(0);
    expect(errors[0]).toBe(
      "capacitorSaveAdapter: this page is not running inside a Capacitor " +
        "app. Leave this adapter out of a browser build.",
    );
    expect(await page.evaluate(() => window.__yage__ === undefined)).toBe(true);
  });

  test("the Electron entry says what a browser page is missing", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/baseline-electron.html");
    await expect.poll(() => errors.length).toBeGreaterThan(0);
    expect(errors[0]).toBe(
      "electronSaveAdapter: no YAGE host bridge on this page. Load the game " +
        "in a shell that runs the @yagejs/host-electron preload script, or " +
        "leave this adapter out of a browser build.",
    );
    expect(await page.evaluate(() => window.__yage__ === undefined)).toBe(true);
  });
});

test.describe("baseline under a policy that forbids string evaluation", () => {
  test("every case draws what the default page draws", async ({ page }) => {
    await gotoFixture(page, "/baseline.html");
    await waitForSettled(page);
    const allowed = await read(page);
    expect(allowed.policy.stringEvaluation).toBe(true);
    const allowedPixels = await readPixels(page);

    await gotoFixture(page, "/baseline-strict.html");
    await waitForSettled(page);
    const strict = await read(page);
    expect(strict.policy.stringEvaluation).toBe(false);
    expect(strict.cases).toEqual(CASE_NAMES);
    expect(strict.settledCases).toEqual(CASE_NAMES);
    expect(strict.errors.callbackErrors).toEqual([]);
    expect(
      (strict.readings["display"]!["graphics"] as Record<string, unknown>)[
        "backend"
      ],
    ).toBe("webgl2");
    expect(await readPixels(page)).toEqual(allowedPixels);
  });
});

test.describe("baseline saves", () => {
  test("each profile starts clean and a reload continues", async ({
    browser,
  }) => {
    const first = await browser.newContext();
    const page = await first.newPage();
    await openBaseline(page, "?case=saves");
    await waitForSettled(page);
    expect((await read(page)).readings["saves"]).toMatchObject({
      launchesBefore: 0,
      launchesAfter: 1,
      slotBefore: null,
      slotAfter: 1,
    });

    await page.reload();
    await page.waitForFunction(
      () => window.__yage__?.inspector?.getExtension("baseline") !== undefined,
    );
    await waitForSettled(page);
    expect((await read(page)).readings["saves"]).toMatchObject({
      launchesBefore: 1,
      launchesAfter: 2,
      slotBefore: 1,
      slotAfter: 2,
    });
    await first.close();

    const second = await browser.newContext();
    const fresh = await second.newPage();
    await openBaseline(fresh, "?case=saves");
    await waitForSettled(fresh);
    expect((await read(fresh)).readings["saves"]).toMatchObject({
      launchesBefore: 0,
      launchesAfter: 1,
      slotBefore: null,
      slotAfter: 1,
    });
    await second.close();
  });
});

test.describe("baseline lifecycle", () => {
  /** Give a page a hidden state, which a browser under automation never enters. */
  async function setHidden(page: Page, hidden: boolean): Promise<void> {
    await page.evaluate((value) => {
      if (value) {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => "hidden",
        });
        Object.defineProperty(document, "hidden", {
          configurable: true,
          get: () => true,
        });
      } else {
        delete (document as unknown as Record<string, unknown>)[
          "visibilityState"
        ];
        delete (document as unknown as Record<string, unknown>)["hidden"];
      }
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
  }

  test("a hidden page pauses and a visible one resumes", async ({ page }) => {
    await openBaseline(page, "?case=lifecycle");
    await waitForSettled(page);

    await setHidden(page, true);
    await expect
      .poll(async () => (await read(page)).readings["lifecycle"])
      .toMatchObject({
        active: false,
        pausedNow: true,
        activeChanges: [false],
      });

    await setHidden(page, false);
    await expect
      .poll(async () => (await read(page)).readings["lifecycle"])
      .toMatchObject({
        active: true,
        pausedNow: false,
        activeChanges: [false, true],
      });
    const reading = (await read(page)).readings["lifecycle"]!;
    expect(reading["firstFrameAfterResumeMs"]).toBeLessThanOrEqual(100);
  });
});

for (const deviceScaleFactor of [1, 2]) {
  test.describe(`baseline input at device scale factor ${deviceScaleFactor}`, () => {
    test.use({ deviceScaleFactor });

    test("a key press and a click reach the action map", async ({ page }) => {
      await openBaseline(page, "?case=input");
      await waitForSettled(page);

      await page.keyboard.press("Space");
      await expect
        .poll(async () => (await read(page)).readings["input"]!["jumpPresses"])
        .toBe(1);

      const point = await page.evaluate(() =>
        window
          .__yage__!.inspector.getExtension<BaselineExtension>("baseline")!
          .pointFor(320, 180),
      );
      await page.mouse.click(point.x, point.y);
      await expect
        .poll(async () => (await read(page)).readings["input"]!["lastPointer"])
        .toMatchObject({ type: "mouse" });
      const pointer = (await read(page)).readings["input"]!["lastPointer"] as {
        x: number;
        y: number;
      };
      expect(Math.abs(pointer.x - 320)).toBeLessThanOrEqual(1);
      expect(Math.abs(pointer.y - 180)).toBeLessThanOrEqual(1);
    });

    test("a touch reaches the same reading", async ({ page, context }) => {
      await openBaseline(page, "?case=input");
      await waitForSettled(page);

      const point = await page.evaluate(() =>
        window
          .__yage__!.inspector.getExtension<BaselineExtension>("baseline")!
          .pointFor(320, 180),
      );
      const session = await context.newCDPSession(page);
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: point.x, y: point.y }],
      });
      await session.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await expect
        .poll(async () => (await read(page)).readings["input"]!["lastPointer"])
        .toMatchObject({ type: "touch" });
      const pointer = (await read(page)).readings["input"]!["lastPointer"] as {
        x: number;
        y: number;
      };
      expect(Math.abs(pointer.x - 320)).toBeLessThanOrEqual(1);
      expect(Math.abs(pointer.y - 180)).toBeLessThanOrEqual(1);
      await session.detach();
    });
  });
}

test.describe("baseline graphics", () => {
  /**
   * The lamp lit its own spot and the far corner stayed at the ambient
   * level. The fixture draws on a near-black background, so the gap between
   * the two is a few tens of levels rather than a few hundred.
   */
  function expectLampBrighterThanShadow(
    pixels: Record<string, [number, number, number, number]>,
  ): void {
    const lamp = pixels["lamp"]!;
    const far = pixels["far"]!;
    for (let i = 0; i < 3; i++) {
      expect(lamp[i]! - far[i]!, `channel ${i}`).toBeGreaterThan(8);
    }
  }

  /** Every point of the drawing is the colour it was, within rounding. */
  function expectSamePixels(
    before: Record<string, [number, number, number, number]>,
    after: Record<string, [number, number, number, number]>,
  ): void {
    for (const [name, channels] of Object.entries(before)) {
      const drawn = after[name]!;
      for (let i = 0; i < channels.length; i++) {
        expect(
          Math.abs(drawn[i]! - channels[i]!),
          `${name} channel ${i}`,
        ).toBeLessThanOrEqual(2);
      }
    }
  }

  test("a WebGL 1 context draws every case through the overlay renderer", async ({
    page,
  }) => {
    await openBaseline(page, "?backend=webgl1");
    await waitForSettled(page);
    const reading = await read(page);
    expect(reading.errors.callbackErrors).toEqual([]);

    const graphics = reading.readings["display"]!["graphics"] as Record<
      string,
      unknown
    >;
    expect(graphics["backend"]).toBe("webgl1");
    expect(graphics["maxSamples"]).toBe(0);
    expect(await readLighting(page)).toMatchObject([
      { scene: "baseline", fallback: { reason: "webgl1", detail: null } },
    ]);

    expectLampBrighterThanShadow(await readPixels(page));
  });

  for (const deviceScaleFactor of [1, 2]) {
    test.describe(`at device scale factor ${deviceScaleFactor}`, () => {
      test.use({ deviceScaleFactor });

      test("a lost and restored context draws every case as before", async ({
        page,
      }) => {
        await openBaseline(page);
        await waitForSettled(page);
        const before = await readPixels(page);

        await page.evaluate(() =>
          window
            .__yage__!.inspector.getExtension<BaselineExtension>("baseline")!
            .loseContext(),
        );

        expectSamePixels(before, await readPixels(page));
        expect((await read(page)).graphicsContext).toEqual([true, false]);
        expect(
          await page.evaluate(() =>
            window
              .__yage__!.inspector.getExtension<{
                contextLost(): boolean;
              }>("graphics")!
              .contextLost(),
          ),
        ).toBe(false);
      });
    });
  }

  test("a buffer that follows the pixel ratio keeps the canvas density", async ({
    page,
  }) => {
    await openBaseline(page, "?case=render-targets");
    await waitForSettled(page);
    expect((await read(page)).readings["render-targets"]).toMatchObject({
      resolution: 1,
      followingResolution: 1,
    });

    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 720,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await expect
      .poll(
        async () =>
          (await read(page)).readings["render-targets"]!["followingResolution"],
      )
      .toBe(2);
    const reading = (await read(page)).readings["render-targets"]!;
    // A buffer without the option keeps the density it was built with.
    expect(reading["resolution"]).toBe(1);
    // The buffer's own magenta, darkened by the scene's ambient light.
    const magenta = (await readPixels(page))["followingTarget"]!;
    expect(magenta[0]).toBeGreaterThan(30);
    expect(magenta[1]).toBeLessThan(10);
    expect(magenta[2]).toBeGreaterThan(30);
    await session.detach();
  });

  test("bounce draws as the mix where the context has no min/max blending", async ({
    page,
  }) => {
    await openBaseline(page, "?backend=webgl1&bounce=max");
    await waitForSettled(page);
    expect((await read(page)).readings["display"]!["graphics"]).toMatchObject({
      blendMinMax: "supported",
    });
    expect(await readLighting(page)).toMatchObject([
      { bounce: { requested: "max", drawn: "max" } },
    ]);

    const without = await page.context().newPage();
    await without.addInitScript(() => {
      const proto = WebGLRenderingContext.prototype as unknown as {
        getExtension(name: string): unknown;
      };
      const original = proto.getExtension;
      proto.getExtension = function (name: string): unknown {
        if (name === "EXT_blend_minmax") return null;
        return Reflect.apply(original, this, [name]);
      };
    });
    await openBaseline(without, "?backend=webgl1&bounce=max");
    await waitForSettled(without);
    expect(
      (await read(without)).readings["display"]!["graphics"],
    ).toMatchObject({ blendMinMax: "unsupported" });
    expect(await readLighting(without)).toMatchObject([
      { bounce: { requested: "max", drawn: "mix" } },
    ]);
    await without.close();
  });

  test("a driver that refuses the light shader gets the overlay and the log", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const REFUSED = "rejected by the test";
      const rejected = new WeakSet<WebGLProgram>();
      const sources = new WeakMap<WebGLShader, string>();
      const attached = new WeakMap<WebGLProgram, WebGLShader[]>();
      const proto = WebGL2RenderingContext.prototype;
      const shaderSource = proto.shaderSource;
      proto.shaderSource = function (shader, source: string): void {
        sources.set(shader, source);
        Reflect.apply(shaderSource, this, [shader, source]);
      };
      const attachShader = proto.attachShader;
      proto.attachShader = function (program, shader): void {
        const list = attached.get(program) ?? [];
        list.push(shader);
        attached.set(program, list);
        if ((sources.get(shader) ?? "").includes("SLOT_SCALE")) {
          rejected.add(program);
        }
        Reflect.apply(attachShader, this, [program, shader]);
      };
      const getProgramParameter = proto.getProgramParameter;
      proto.getProgramParameter = function (program, name: number): unknown {
        if (name === this.LINK_STATUS && rejected.has(program)) return false;
        return Reflect.apply(getProgramParameter, this, [program, name]);
      };
      const getProgramInfoLog = proto.getProgramInfoLog;
      proto.getProgramInfoLog = function (program): string | null {
        if (rejected.has(program)) return REFUSED;
        return Reflect.apply(getProgramInfoLog, this, [program]);
      };
    });
    await openBaseline(page);
    await waitForSettled(page);

    expect((await read(page)).errors.callbackErrors).toEqual([]);
    expect(await readLighting(page)).toMatchObject([
      {
        fallback: { reason: "shader-rejected", detail: "rejected by the test" },
      },
    ]);
    expectLampBrighterThanShadow(await readPixels(page));
  });

  test("a browser with neither WebGL nor WebGPU stops the start", async ({
    baseURL,
  }) => {
    const browser = await chromium.launch({ args: ["--disable-3d-apis"] });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(new URL("baseline.html", baseURL).href);
      await expect.poll(() => errors.length).toBeGreaterThan(0);
      expect(errors.join("\n")).toContain(
        "No available renderer for the current environment",
      );
      expect(
        await page.evaluate(
          () =>
            window.__yage__?.inspector?.getExtension("baseline") === undefined,
        ),
      ).toBe(true);
    } finally {
      await browser.close();
    }
  });
});

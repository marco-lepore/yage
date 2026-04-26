import { test, expect, type Page } from "@playwright/test";
import {
  gotoFixture,
  waitForClock,
  stepFrames,
  waitForSceneStackLength,
} from "./helpers.js";

interface LayerXform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

interface LifecycleAPI {
  setBaseCameraPosition(x: number, y: number): void;
  setBaseCameraZoom(z: number): void;
  disableBaseCamera(): void;
  enableBaseCamera(): void;
  pushOverlay(): Promise<void>;
  popTop(): Promise<void>;
}

interface CameraStackSnapshot {
  scene: string;
  name: string | undefined;
  priority: number;
  enabled: boolean;
}

interface DebugDiagnostics {
  getLayerTransform(
    sceneName: string,
    layerName: string,
  ): LayerXform | undefined;
  getCameraStack(): CameraStackSnapshot[];
}

interface InspectorAPI {
  getSceneStack(): Array<{ name: string }>;
  getExtension<T extends object>(namespace: string): T | undefined;
}

type LifecycleWin = Window & {
  __cameraTest__?: LifecycleAPI;
  __yage__?: { inspector: InspectorAPI };
};

async function waitForControls(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as LifecycleWin).__cameraTest__ !== undefined,
  );
}

test.describe("Camera lifecycle", () => {
  test("world layer resets to identity when the last camera is disabled", async ({
    page,
  }) => {
    await gotoFixture(page, "/camera-lifecycle.html");
    await waitForClock(page);
    await waitForControls(page);

    await page.evaluate(() => {
      const api = (window as LifecycleWin).__cameraTest__;
      if (!api) throw new Error("__cameraTest__ controls are not available");
      api.setBaseCameraPosition(200, 100);
      api.setBaseCameraZoom(2);
    });
    await stepFrames(page, 1);

    let world = await page.evaluate(() =>
      (window as LifecycleWin).__yage__?.inspector.getExtension<DebugDiagnostics>("debug")?.getLayerTransform(
        "base",
        "world",
      ),
    );
    expect(world!.scaleX).toBe(2);
    // position.x = viewportW/2 - camX * zoom = 400 - 200*2 = 0
    expect(world!.x).toBe(0);

    // Disable the only camera on the scene — layer must reset to identity.
    await page.evaluate(() => {
      const api = (window as LifecycleWin).__cameraTest__;
      if (!api) throw new Error("__cameraTest__ controls are not available");
      api.disableBaseCamera();
    });
    await stepFrames(page, 1);

    world = await page.evaluate(() =>
      (window as LifecycleWin).__yage__?.inspector.getExtension<DebugDiagnostics>("debug")?.getLayerTransform(
        "base",
        "world",
      ),
    );
    expect(world!.x).toBe(0);
    expect(world!.y).toBe(0);
    expect(world!.scaleX).toBe(1);
    expect(world!.scaleY).toBe(1);
    expect(world!.rotation).toBe(0);

    // Re-enable — camera transform reapplies.
    await page.evaluate(() => {
      const api = (window as LifecycleWin).__cameraTest__;
      if (!api) throw new Error("__cameraTest__ controls are not available");
      api.enableBaseCamera();
    });
    await stepFrames(page, 1);
    world = await page.evaluate(() =>
      (window as LifecycleWin).__yage__?.inspector.getExtension<DebugDiagnostics>("debug")?.getLayerTransform(
        "base",
        "world",
      ),
    );
    expect(world!.scaleX).toBe(2);
  });

  test("auto-provisioned UI layer never moves, however hard the camera does", async ({
    page,
  }) => {
    await gotoFixture(page, "/camera-lifecycle.html");
    await waitForClock(page);
    await waitForControls(page);

    await page.evaluate(() => {
      const api = (window as LifecycleWin).__cameraTest__;
      if (!api) throw new Error("__cameraTest__ controls are not available");
      api.setBaseCameraPosition(1000, 500);
      api.setBaseCameraZoom(3);
    });
    await stepFrames(page, 1);

    const ui = await page.evaluate(() =>
      (window as LifecycleWin).__yage__?.inspector.getExtension<DebugDiagnostics>("debug")?.getLayerTransform(
        "base",
        "ui",
      ),
    );
    expect(
      ui,
      "ui layer should exist — UIPanel auto-provisions it",
    ).not.toBeNull();
    expect(ui!.x).toBe(0);
    expect(ui!.y).toBe(0);
    expect(ui!.scaleX).toBe(1);
    expect(ui!.scaleY).toBe(1);
    expect(ui!.rotation).toBe(0);
  });

  test("pushing an overlay scene with its own camera leaves the base scene's transform intact", async ({
    page,
  }) => {
    await gotoFixture(page, "/camera-lifecycle.html");
    await waitForClock(page);
    await waitForControls(page);

    await page.evaluate(() => {
      const api = (window as LifecycleWin).__cameraTest__;
      if (!api) throw new Error("__cameraTest__ controls are not available");
      api.setBaseCameraPosition(100, 0);
    });
    await stepFrames(page, 1);

    const before = await page.evaluate(() =>
      (window as LifecycleWin).__yage__?.inspector.getExtension<DebugDiagnostics>("debug")?.getLayerTransform(
        "base",
        "world",
      ),
    );
    // position.x = 400 - 100*1 = 300
    expect(before!.x).toBe(300);

    await page.evaluate(async () => {
      const api = (window as LifecycleWin).__cameraTest__;
      if (!api) throw new Error("__cameraTest__ controls are not available");
      await api.pushOverlay();
    });
    await waitForSceneStackLength(page, 2);
    await stepFrames(page, 2);

    const stackNames = await page.evaluate(() =>
      (window as LifecycleWin).__yage__?.inspector
        .getSceneStack()
        .map((scene) => scene.name),
    );
    expect(stackNames).toEqual(["base", "overlay"]);

    // Both scenes are in the stack; each has its own camera.
    const camScenes = await page.evaluate(() =>
      (window as LifecycleWin).__yage__?.inspector
        .getExtension<DebugDiagnostics>("debug")
        ?.getCameraStack()
        .map((camera) => camera.scene),
    );
    expect(camScenes).toEqual(["base", "overlay"]);

    // The base scene's world layer keeps its transform — separate render
    // trees per scene means the overlay camera cannot disturb it.
    const baseAfter = await page.evaluate(() =>
      (window as LifecycleWin).__yage__?.inspector.getExtension<DebugDiagnostics>("debug")?.getLayerTransform(
        "base",
        "world",
      ),
    );
    expect(baseAfter!.x).toBe(300);

    // The overlay's own camera (position 0,0) centers its own layer.
    const overlayLayer = await page.evaluate(() =>
      (window as LifecycleWin).__yage__?.inspector.getExtension<DebugDiagnostics>("debug")?.getLayerTransform(
        "overlay",
        "overlay-content",
      ),
    );
    expect(overlayLayer!.x).toBe(400);
    expect(overlayLayer!.y).toBe(300);

    await page.evaluate(async () => {
      const api = (window as LifecycleWin).__cameraTest__;
      if (!api) throw new Error("__cameraTest__ controls are not available");
      await api.popTop();
    });
    await waitForSceneStackLength(page, 1);
    await stepFrames(page, 1);

    const baseFinal = await page.evaluate(() =>
      (window as LifecycleWin).__yage__?.inspector.getExtension<DebugDiagnostics>("debug")?.getLayerTransform(
        "base",
        "world",
      ),
    );
    expect(baseFinal!.x).toBe(300);
  });
});

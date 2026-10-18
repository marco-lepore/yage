import { Engine } from "@yagejs/core";
import type { Plugin } from "@yagejs/core";
import { AudioPlugin } from "@yagejs/audio";
import { InputPlugin } from "@yagejs/input";
import { LightingPlugin, shaderLighting } from "@yagejs/lighting";
import { PhysicsPlugin } from "@yagejs/physics";
import { RendererPlugin } from "@yagejs/renderer";
import type { RendererConfig } from "@yagejs/renderer";
import { SavePlugin, createSave } from "@yagejs/save";
import type { SaveAdapter } from "@yagejs/save";
import type { BounceLightOptions } from "@yagejs/lighting";
import { UIPlugin } from "@yagejs/ui";
import { BaselineScene, CASE_NAMES, selectCases } from "./cases.js";
import type { installTestProfile, testProfilePlugins } from "./test-profile.js";

/** Which entry built the page. Recorded in every reading; never branched on. */
export type BaselineTarget = "web" | "electron" | "capacitor";

/** Which build of the fixture is running. */
export type BaselineProfile = "test" | "release";

/** What one target's entry hands to {@link bootBaseline}. */
export interface BaselineBootOptions {
  readonly target: BaselineTarget;
  /** The host adapter plugins this target installs unconditionally. */
  readonly hostPlugins: readonly Plugin[];
  /** Where the saves case writes. */
  readonly saveAdapter: SaveAdapter;
}

/** The part of the test profile this module calls. */
interface TestProfile {
  testProfilePlugins: typeof testProfilePlugins;
  installTestProfile: typeof installTestProfile;
}

const VIRTUAL_WIDTH = 640;
const VIRTUAL_HEIGHT = 360;

/** The bounce the `bounce=max` build draws with. */
const MAX_BOUNCE: BounceLightOptions = {
  strength: 0.6,
  radius: 40,
  blend: "max",
};

/**
 * The Pixi options a `backend` launch flag asks for. A test build reads the
 * flag so one page can be driven on each graphics API the renderer draws
 * with; a release build asks for nothing and takes the renderer's own order.
 */
function backendOptions(search: string): RendererConfig["pixi"] {
  const requested = new URLSearchParams(search).get("backend");
  if (requested === null || requested === "") return undefined;
  if (requested === "webgl1") return { preferWebGLVersion: 1 };
  if (requested === "webgpu") return { preference: "webgpu" };
  throw new Error(
    `Baseline: unknown backend ${JSON.stringify(requested)}. ` +
      "Known backends: webgl1, webgpu.",
  );
}

/**
 * Whether an `activeWhenUnfocused` launch flag asks the game to keep running
 * behind another window. A test build reads it so the cases run on a machine
 * that gives the window no focus.
 */
function activeWhenUnfocused(search: string): boolean {
  const requested = new URLSearchParams(search).get("activeWhenUnfocused");
  if (requested === null || requested === "") return false;
  if (requested === "1") return true;
  throw new Error(
    `Baseline: unknown activeWhenUnfocused ${JSON.stringify(requested)}. ` +
      "Known values: 1.",
  );
}

/** The bounce a `bounce` launch flag asks for, or `undefined` for none. */
function bounceOption(search: string): BounceLightOptions | undefined {
  const requested = new URLSearchParams(search).get("bounce");
  if (requested === null || requested === "") return undefined;
  if (requested === "max") return MAX_BOUNCE;
  throw new Error(
    `Baseline: unknown bounce ${JSON.stringify(requested)}. ` +
      "Known values: max.",
  );
}

/** Start the fixture: select the cases, install the plugins, push the scene. */
export async function bootBaseline(
  options: BaselineBootOptions,
): Promise<void> {
  const profile: BaselineProfile =
    import.meta.env.MODE === "release" ? "release" : "test";
  // A launch flag belongs to a test build, so a release build mounts
  // everything and reads no query string.
  const cases =
    profile === "release" ? CASE_NAMES : selectCases(location.search);
  const search = profile === "release" ? "" : location.search;
  const pixi = backendOptions(search);
  const bounce = bounceOption(search);

  let testProfile: TestProfile | undefined;
  if (import.meta.env.MODE !== "release") {
    testProfile = await import("./test-profile.js");
  }

  const container = document.getElementById("game");
  if (container === null) {
    throw new Error("bootBaseline: the page has no element with the id game.");
  }

  const engine = new Engine({ debug: profile === "test" });
  for (const plugin of options.hostPlugins) engine.use(plugin);
  engine.use(
    new RendererPlugin({
      width: VIRTUAL_WIDTH,
      height: VIRTUAL_HEIGHT,
      backgroundColor: 0x111111,
      container,
      ...(pixi ? { pixi } : {}),
    }),
  );
  engine.use(new InputPlugin({ actions: { jump: ["Space"] } }));
  engine.use(new AudioPlugin());
  engine.use(new PhysicsPlugin());
  engine.use(new UIPlugin());
  engine.use(
    new LightingPlugin({
      ambient: { level: 0.2 },
      renderers: { shader: shaderLighting() },
      defaultRenderer: "shader",
      ...(bounce ? { bounce } : {}),
    }),
  );
  engine.use(
    new SavePlugin({ save: createSave({ adapter: options.saveAdapter }) }),
  );
  if (testProfile) {
    for (const plugin of testProfile.testProfilePlugins()) engine.use(plugin);
  }

  if (activeWhenUnfocused(search)) engine.host.activeWhenUnfocused = true;

  await engine.start();
  const scene = new BaselineScene(cases);
  await engine.scenes.push(scene);
  testProfile?.installTestProfile(engine, scene, options.target);
}

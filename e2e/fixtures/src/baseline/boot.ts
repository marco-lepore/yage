import { Engine } from "@yagejs/core";
import type { Plugin } from "@yagejs/core";
import { AudioPlugin } from "@yagejs/audio";
import { InputPlugin } from "@yagejs/input";
import {
  LightingPlugin,
  overlayLighting,
  shaderLighting,
} from "@yagejs/lighting";
import { PhysicsPlugin } from "@yagejs/physics";
import { RendererPlugin } from "@yagejs/renderer";
import { SavePlugin, createSave } from "@yagejs/save";
import type { SaveAdapter } from "@yagejs/save";
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
    }),
  );
  engine.use(new InputPlugin({ actions: { jump: ["Space"] } }));
  engine.use(new AudioPlugin());
  engine.use(new PhysicsPlugin());
  engine.use(new UIPlugin());
  engine.use(
    new LightingPlugin({
      ambient: { level: 0.2 },
      renderers: { shader: shaderLighting({ fallback: overlayLighting() }) },
      defaultRenderer: "shader",
    }),
  );
  engine.use(
    new SavePlugin({ save: createSave({ adapter: options.saveAdapter }) }),
  );
  if (testProfile) {
    for (const plugin of testProfile.testProfilePlugins()) engine.use(plugin);
  }

  await engine.start();
  const scene = new BaselineScene(cases);
  await engine.scenes.push(scene);
  testProfile?.installTestProfile(engine, scene, options.target);
}

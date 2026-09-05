import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
// Run with: node scripts/measure-vector-allocations.mjs
// Counts actual YAGE Vec2 constructor calls, not heap bytes or Rapier wrappers.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(repo, "package.json"));
const { build } = require("esbuild");
const ts = require("typescript");
let instrumented = 0;
const result = await build({
  stdin: {
    contents: `
import RAPIER from "@dimforge/rapier2d";
import { Engine, Entity, Scene, Transform, Vec2, Vec2Buffer } from "@yagejs/core";
import { PhysicsPlugin } from "./packages/physics/src/PhysicsPlugin.ts";
import { RigidBodyComponent } from "./packages/physics/src/RigidBodyComponent.ts";
import { ColliderComponent } from "./packages/physics/src/ColliderComponent.ts";
export { RAPIER, Engine, Entity, Scene, Transform, Vec2, Vec2Buffer, PhysicsPlugin, RigidBodyComponent, ColliderComponent };
`,
    resolveDir: repo,
    loader: "ts",
  },
  alias: {
    "@yagejs/core": resolve(repo, "packages/core/src/index.ts"),
    "@dimforge/rapier2d": require.resolve("@dimforge/rapier2d-compat"),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  banner: {
    js: `import { createRequire as __createRequire } from "node:module"; const require = __createRequire(${JSON.stringify(resolve(repo, "package.json"))});`,
  },
  plugins: [
    {
      name: "count-vec2",
      setup(plugin) {
        plugin.onLoad({ filter: /\/Vec2\.ts$/ }, ({ path }) => {
          const source = readFileSync(path, "utf8");
          const ast = ts.createSourceFile(
            path,
            source,
            ts.ScriptTarget.Latest,
            true,
          );
          const vec = ast.statements.find(
            (n) => ts.isClassDeclaration(n) && n.name?.text === "Vec2",
          );
          const ctor = vec?.members.find(ts.isConstructorDeclaration);
          if (!ctor?.body) throw new Error("Vec2 constructor missing.");
          const at = ctor.body.getStart(ast) + 1;
          instrumented++;
          return {
            contents:
              source.slice(0, at) +
              "globalThis.__yageVec2Allocations = (globalThis.__yageVec2Allocations ?? 0) + 1;" +
              source.slice(at),
            loader: "ts",
          };
        });
      },
    },
  ],
});
if (instrumented !== 1)
  throw new Error(`Expected one Vec2, got ${instrumented}.`);
const api = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text + "\n//# sourceURL=yage-physics-probe-bundle.mjs").toString("base64")}`
);
const {
  RAPIER,
  Engine,
  Entity,
  Scene,
  Transform,
  Vec2,
  Vec2Buffer,
  PhysicsPlugin,
  RigidBodyComponent,
  ColliderComponent,
} = api;
await RAPIER.init();
globalThis.__yageVec2Allocations = 0;
for (let i = 0; i < 7; i++) new Vec2(i, i);
if (globalThis.__yageVec2Allocations !== 7)
  throw new Error("Positive control failed.");
class ProbeScene extends Scene {
  name = "allocation-probe";
}

function measureTransform(name, setup, operation, expected) {
  const transform = setup();
  const out = new Vec2Buffer();
  globalThis.__yageVec2Allocations = 0;
  let checksum = 0;
  for (let i = 0; i < 10000; i++) checksum += operation(transform, out, i);
  const count = globalThis.__yageVec2Allocations;
  assert.equal(count, expected, name);
  console.log(
    JSON.stringify({
      name,
      iterations: 10000,
      vec2Constructions: count,
      checksum,
    }),
  );
}
function parentedTransform() {
  const parent = new Entity("parent");
  parent.add(
    new Transform({
      position: { x: 3, y: 4 },
      rotation: 0.3,
      scale: { x: 2, y: 3 },
    }),
  );
  const child = new Entity("child");
  const transform = child.add(new Transform());
  parent.addChild("child", child);
  return transform;
}
measureTransform(
  "scalar local writes",
  () => new Transform(),
  (t, out, i) => {
    t.setPosition(i, -i);
    t.setScale(2, 3);
    t.setRotation(0.3);
    t.getPositionInto(out);
    t.getScaleInto(out);
    return out.x;
  },
  0,
);
measureTransform(
  "parented scalar local writes and Into reads",
  parentedTransform,
  (t, out, i) => {
    t.setPosition(i, -i);
    t.getWorldScaleInto(out);
    return t.getWorldPositionInto(out).x;
  },
  0,
);
measureTransform(
  "parented scalar world writes and Into reads",
  parentedTransform,
  (t, out, i) => {
    t.setWorldPosition(i, -i);
    return t.getWorldPositionInto(out).x;
  },
  0,
);
measureTransform(
  "parented scalar writes and immutable snapshots",
  parentedTransform,
  (t, out, i) => {
    t.setWorldPosition(i, -i);
    return t.worldPosition.x;
  },
  10000,
);
const bodies = 64;
const frames = 240;
for (const parented of [false, true]) {
  for (const readPose of [false, true]) {
    const engine = new Engine({ fixedTimestep: 1 / 60 });
    engine.use(new PhysicsPlugin({ gravity: { x: 0, y: 0 } }));
    await engine.start();
    const scene = new ProbeScene();
    await engine.scenes.push(scene);
    const parent = parented ? scene.spawn("parent") : undefined;
    parent?.add(new Transform({ rotation: 0.3, scale: new Vec2(2, 3) }));
    const transforms = [];
    for (let i = 0; i < bodies; i++) {
      const entity = scene.spawn(`body-${i}`);
      const transform = entity.add(
        new Transform({ position: new Vec2(i * 100, i * 100) }),
      );
      parent?.addChild(`body-${i}`, entity);
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));
      entity.add(
        new ColliderComponent({ shape: { type: "circle", radius: 2 } }),
      );
      rb.setVelocity({ x: 10, y: 4 });
      transforms.push(transform);
    }
    for (let i = 0; i < 120; i++) engine.loop.tick(1000 / 60);
    globalThis.__yageVec2Allocations = 0;
    const startFrame = engine.loop.frameCount;
    let checksum = 0;
    for (let i = 0; i < frames; i++) {
      engine.loop.tick(1000 / 60);
      if (readPose) for (const t of transforms) checksum += t.worldPosition.x;
    }

    const count = globalThis.__yageVec2Allocations;
    assert.equal(
      count,
      readPose ? bodies * frames : 0,
      "physics Vec2 construction count",
    );
    assert.equal(engine.loop.frameCount - startFrame, frames);
    if (readPose) {
      const baseline = parented ? 49857432.35528469 : 48690735.87834835;
      assert.ok(Math.abs(checksum - baseline) < 1e-6, "physics pose checksum");
    }
    console.log(
      JSON.stringify({
        bodies,
        frames,
        parented,
        readPose,
        vec2Constructions: count,
        checksum,
      }),
    );
    engine.destroy();
  }
}

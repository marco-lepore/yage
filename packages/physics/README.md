# @yage/physics

Rapier 2D physics integration - rigid bodies, colliders, and joints for the [YAGE](https://yage.dev) 2D game engine.

## Install

```bash
npm install @yage/physics
```

Bundles [Rapier 2D](https://rapier.rs/) - no separate install required. Rapier uses WebAssembly; if you use Vite, install `vite-plugin-wasm`.

## Usage

```ts
import { Engine } from "@yage/core";
import { PhysicsPlugin, RigidBodyComponent, ColliderComponent } from "@yage/physics";

const engine = new Engine();
engine.use(new PhysicsPlugin({ gravity: { x: 0, y: 980 } }));
```

Attach bodies and colliders to entities:

```ts
entity.add(new RigidBodyComponent({ type: "dynamic" }));
entity.add(new ColliderComponent({ shape: { type: "box", width: 40, height: 40 } }));
```

## What's in the box

- **PhysicsPlugin** - Rapier world management with fixed-timestep accumulator
- **RigidBodyComponent** - dynamic, static, kinematic bodies
- **ColliderComponent** - boxes, circles, polygons, sensors with trigger events
- **Raycasts** - query the world for collisions along a ray
- **Collision layers / masks** - filter collisions by group
- **Joints** - distance, revolute, prismatic, fixed

## Docs

Full documentation at [yage.dev](https://yage.dev).

## License

MIT

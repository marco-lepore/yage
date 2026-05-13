# YAGE Troubleshooting

Dev-mode warnings YAGE emits to flag silent failure modes. All warnings are
prefixed with `[yage]` and gated on `process.env.NODE_ENV !== "production"`,
so they tree-shake out of minified production bundles.

## Component.use(...) called before the component is bound to an entity

`this.use(Key)` reads `this.entity.scene` eagerly, which crashes when called
from a field initializer — field initializers run before `entity.add(...)`
binds the component to its entity.

```ts
// ❌ Throws on construction
class Foo extends Component {
  readonly input = this.use(InputManagerKey);
}

// ✅ Resolves lazily on first access
class Foo extends Component {
  readonly input = this.service(InputManagerKey);
}

// ✅ Resolves at lifecycle time
class Foo extends Component {
  private input!: InputManager;
  onAdd() { this.input = this.use(InputManagerKey); }
}
```

## ColliderComponent at &lt;entity&gt;: sensor: true colliders fire onTrigger, not onCollision

Sensor colliders never fire `onCollision`; non-sensor colliders never fire
`onTrigger`. The warning surfaces a handler attached to the wrong channel.

```ts
const col = entity.add(new ColliderComponent({
  shape: { type: "box", width: 32, height: 32 },
  sensor: true,
}));
col.onTrigger(({ other, entered }) => { /* ... */ });
```

## Asymmetric collision masks

Rapier's pair filter is symmetric: a contact only fires when
`A.layers & B.mask` AND `B.layers & A.mask` are both non-zero. Setting one
side's mask without the matching membership on the other side produces a
trigger that silently never fires. Update either side's `layers` or `mask`
so both checks pass.

## Layer 'ui' is the canonical UI layer name

`@yagejs/ui` auto-provisions a screen-space layer called `"ui"` if the scene
does not declare one. Declaring a layer with `name: "ui"` and no explicit
`space` defaults to `"world"`, which overrides the auto-provisioned screen
layer with a world-space one — UI then scrolls and zooms with the camera.

```ts
class GameScene extends Scene {
  readonly layers = [
    { name: "ui", order: 1000, space: "screen" as const },
  ];
}
```

## Polygon collider with N input vertices reduced to M after convex hull

`ColliderShape: "polygon"` builds a Rapier convex hull, which drops vertices
when the input is concave. Decompose the shape into convex pieces (attach
multiple `ColliderComponent`s) or use a `polyline` shape for collision-as-
contour static geometry.

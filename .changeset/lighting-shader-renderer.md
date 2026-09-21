---
"@yagejs/lighting": patch
---

Add a second built-in renderer that draws shadow borders and soft cone edges.

`shaderLighting()` returns a renderer factory beside `overlayLighting()`. It draws each light as one quad whose fragment shader works out, for every pixel that quad covers, how much of the lamp the occluders leave visible there. That is the sum `LightingWorld.levelAt()` does, so a crate's shadow is crisp against the floor it stands on and blurred several metres behind it, a lamp wider than a post lights around the post, and a spotlight's edge fades.

```ts
import {
  LightingPlugin,
  overlayLighting,
  shaderLighting,
} from "@yagejs/lighting";

engine.use(
  new LightingPlugin({
    renderers: { soft: shaderLighting(), hard: overlayLighting() },
    defaultRenderer: "soft",
  }),
);

class CaveScene extends Scene {
  readonly name = "cave";
  readonly lighting = { renderer: "soft" };
}
```

`ShaderLightingRendererOptions` takes `layer`, `order`, `resolutionScale` and `fallback`. `resolutionScale` starts at `1`, where the drawn light lands on the same pixel grid `levelAt()` is asked about; the overlay's starts at `0.5`. The drawn picture equals what the query reports up to two sources of rounding: the shader divides a lamp into 128 slots and rounds each hidden stretch out to whole slots at both ends, which is 2/128 of that light's contribution for each separate stretch hidden from a pixel, and the light buffer holds 8 bits per channel. The overlay keeps its single hard edge, through the middle of that border.

Which one a scene wants: the overlay builds a shape and a shadow mask per light and rebuilds them when a light or an occluder moves, so its cost grows with moving lights and with occluder outline in reach. The shader renderer spends nothing on shapes and walks the shapes in reach for every lit pixel, so its cost grows with lit screen area times shapes nearby.

`LightConeOptions` takes `softness`, from 0 to 1, with a `coneSoftness` accessor on `LightSource`. It says how much of the cone's spread the light fades over at its edge, and it defaults to `0`, a cone that ends on a line. The fade is part of `levelAt()`, so a guard half-way into a soft edge reads as half lit; `shaderLighting()` draws it and `overlayLighting()` draws one hard edge through the middle of it.

Occluder shapes reach the shader through one data texture per scene, so nothing caps how much outline a light may reach and nothing is dropped. A WebGL shader and a WebGPU shader ship together, drawing the same picture from the same uniforms and the same occluder data.

`fallback` takes another renderer factory and is built instead when the browser hands Pixi a WebGL 1 context, whose shader language has none of what this renderer is written in. That is the one device limit the renderer reads before drawing; a scene on such a context with no `fallback` throws as it is entered, naming the option. A shader a driver refuses on a context that does have the language is a different case and `fallback` does not cover it, because the refusal goes to the browser console rather than to anything the engine can read. A game that wants a cheaper renderer on weaker devices configures both under names and picks one per scene.

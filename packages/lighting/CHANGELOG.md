# @yagejs/lighting

## 0.12.0

### Minor Changes

- [#380](https://github.com/marco-lepore/yage/pull/380) [`ae2002c`](https://github.com/marco-lepore/yage/commit/ae2002c497ff793a81ab3c73267143cc3b35202e) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Configure lighting renderers under names, let a scene pick one, and add bounced light.

  **Breaking:** `LightingConfig.renderer` is replaced by `renderers`, a map from a name to a renderer factory, plus `defaultRenderer`. `renderer: overlayLighting(opts)` becomes `renderers: { overlay: overlayLighting(opts) }` with `defaultRenderer: "overlay"`, and `renderer: null` becomes a `null` entry, such as `renderers: { none: null }` with `defaultRenderer: "none"`. Leave `renderers` out for `{ overlay: overlayLighting() }` under the default name `"overlay"`. Set `renderers` and `defaultRenderer` is required, naming one of the entries: the plugin throws at install when it is missing or names something else, listing the configured names.

  `LightingRendererContext` carries a required `bounce` field, so anything that builds that context by hand — a custom renderer's own tests — has to pass it. `LightingWorldManager`'s constructor takes an options object rather than positional ambient and factory arguments.

  A scene chooses its renderer and its bounced light through a `lighting` property this package adds to core's `Scene`:

  ```ts
  class CaveScene extends Scene {
    readonly name = "cave";
    readonly lighting = {
      renderer: "overlay",
      bounce: { strength: 0.8, radius: 90 },
    };
  }

  engine.use(
    new LightingPlugin({
      renderers: { overlay: overlayLighting(), none: null },
      defaultRenderer: "overlay",
      bounce: { strength: 0.4, radius: 40 },
    }),
  );
  ```

  The property is read once, when the scene is entered and its lighting world is created, so a live scene keeps what it entered with. An unknown renderer name throws there naming the scene and the configured renderers, and so does a bounce setting outside its range. A `null` renderer entry keeps `levelAt()` and draws nothing.

  Bounced light combines the finished light buffer with a blurred, low-resolution copy of itself, so light creeps past shadow edges and around corners. `blend` picks how: `"max"`, the default, keeps the brighter of the two, so lit areas and shadow borders stay as drawn and only the dark is lifted; `"mix"` blends the whole picture toward the blurred copy, which keeps the scene's overall brightness and softens every shadow edge. `strength` runs from 0 to 1 and says how strongly the copy shows, and `radius` is how far the blur reaches in screen pixels, independent of the renderer's `resolutionScale`. A scene that leaves `bounce` out takes `LightingConfig.bounce`, which the plugin checks at install; `bounce: null` on the scene leaves that scene without any; bounce is off when neither sets one. The pass costs one more offscreen buffer per scene and runs only on frames where the light buffer was redrawn. It is a visual treatment — `levelAt()` never sees it, so raise `ambient.level` when gameplay should agree that a shadow is not pitch black.

  `LightingComposite` is the step that owns a scene's light buffer, multiplies it over the scene and applies `bounce`. The built-in overlay finishes with it, and a custom renderer that draws its light into a container can reuse it; the scene's resolved bounce reaches a renderer through `bounce` on its factory context.

- [#375](https://github.com/marco-lepore/yage/pull/375) [`7bf5d5d`](https://github.com/marco-lepore/yage/commit/7bf5d5dafc35682e6b42982afab9804b2c03de9d) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Occluders block light, in the gameplay query and in the built-in overlay renderer.
  - A light contributes to a point only when the straight line between them misses every enabled occluder. Touching an edge or a corner counts as blocked, an occluder containing a light does not block it, a point inside an occluder is dark for every light outside it, and shadows are hard. `LightingWorld.levelAt(x, y)` keeps its signature and answers by that rule, so a scene with occluders reads darker where a wall stands in the way.
  - `OverlayLightingRenderer` draws each light through an inverse mask covering what its occluders hide, so the drawn picture and the query agree. The renderer redraws a light's shadows when the light, an occluder or the camera moves.
  - `LightSource` takes `castShadows`, default `true`. Set it to `false` for a light that reaches through walls.
  - `LightOccluder` follows the entity's world scale: a uniform positive scale resizes the shape, any other scale turns it into a scaled outline, matching how a physics collider follows entity scale. `LightOccluder.scale` reports it.
  - `LightingWorld.levelGridInto(out, grid)` samples a rectangular grid of world points into a caller-owned `Float32Array`, row-major, one sample per cell centre, each equal to `levelAt` at that centre. Each source is summed only over the cells its radius reaches and against the occluders within that radius. The new `LightGrid` type describes the region.
  - The overlay scales a light's drawn radius by the camera's effective zoom, so a zoom modifier moves the drawn light and its position together.

### Patch Changes

- [#388](https://github.com/marco-lepore/yage/pull/388) [`32daae7`](https://github.com/marco-lepore/yage/commit/32daae7686eff5ac5ea5578c7d87c5db866f76f4) Thanks [@marco-lepore](https://github.com/marco-lepore)! - The README quick starts put consequences in components instead of `onEnter` closures. The inventory quick start keeps the `Inventory` in a `Backpack` component on a `Player` entity subclass rather than at module level; virtual controls use a `TouchControls` entity subclass and a component that listens for button presses; the lighting README's `Torch` is an entity subclass, and its `RendererPlugin` sample passes the required config.

- [#379](https://github.com/marco-lepore/yage/pull/379) [`b77ea72`](https://github.com/marco-lepore/yage/commit/b77ea726c4b5cb165b1cd6602f1790de44b90802) Thanks [@marco-lepore](https://github.com/marco-lepore)! - A light has a size and can be narrowed into a spotlight.
  - `LightSource` takes `size`, the lamp's diameter in world pixels, default `0`. A lamp wider than a point is partly hidden behind a blocker's edge, so a partly covered point is dimmed by the share of the lamp it can still see rather than switched off, and the shadow's border widens with the distance from the blocker. `light.size` reads and sets it.
  - `LightingWorld.levelAt(x, y)` and `levelGridInto(out, grid)` scale each source's contribution by that share. The lamp is a line of width `size` centred on the light and square to the direction from the point to it; every occluder's outline is projected onto that line from the point, the projections are merged, and the unblocked share is what is left. At `size: 0` the share is 1 or 0 and the answer is the straight-line test. A wide lamp costs several times more to query, so keep `size` at `0` where a soft border is not wanted.
  - `LightSource` takes `cone: { angle }`, the full spotlight spread in radians, aimed along the entity's world rotation. A cone limits where direct light lands, in the query as well as in the picture. `light.coneAngle` reads and sets it, and a whole turn is the default. `LightSource.rotation` reports the world rotation the cone points along.
  - `OverlayLightingRenderer` draws a light with a cone as a pie slice turned by its entity.
  - Shadow edges in the built-in overlay stay hard whatever a light's `size` says. At `size: 0` the picture is exactly what `levelAt()` reports; above it the drawn edge runs along the middle of the soft border the query answers with. The query is the truth whichever renderer a scene uses.

- [#391](https://github.com/marco-lepore/yage/pull/391) [`c156b12`](https://github.com/marco-lepore/yage/commit/c156b127ceaa5d0c3ee625f83f3bbe7ff49cc530) Thanks [@marco-lepore](https://github.com/marco-lepore)! - The `LightOccluder` documentation says both built-in renderers, `overlayLighting()` and `shaderLighting()`, and the light-level queries treat an enabled occluder as opaque to shadow-casting lights, instead of naming only the overlay renderer.

- [#380](https://github.com/marco-lepore/yage/pull/380) [`5fd8c19`](https://github.com/marco-lepore/yage/commit/5fd8c19075e19ac5fa138ea1bc9e1502b8e99bde) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add a second built-in renderer that draws shadow borders and soft cone edges.

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

- Updated dependencies [[`a1d07ae`](https://github.com/marco-lepore/yage/commit/a1d07ae42d858cf8e94f4bb8414096bdd4a09c16), [`0c90d77`](https://github.com/marco-lepore/yage/commit/0c90d774bdbda47f5a95c92ab7aef11d7a19e7b9), [`1f45e38`](https://github.com/marco-lepore/yage/commit/1f45e38d108b17e37a807c209b5d84159b88867c), [`6888d06`](https://github.com/marco-lepore/yage/commit/6888d06c6fdf2361f41c5521ebdda83dc833b6c4), [`a7fd74e`](https://github.com/marco-lepore/yage/commit/a7fd74e75347a7a1b56ab18fcfb55f2f5cf4da46), [`0f9d0bc`](https://github.com/marco-lepore/yage/commit/0f9d0bce27dd933d562fa6c9c66696b647574e69), [`0f9d0bc`](https://github.com/marco-lepore/yage/commit/0f9d0bce27dd933d562fa6c9c66696b647574e69), [`8e2ea03`](https://github.com/marco-lepore/yage/commit/8e2ea031ab3dd93c2ae09177eb833e8ccd9a2681), [`908622a`](https://github.com/marco-lepore/yage/commit/908622adcf1a401251539e9edd081ad7ffc7e642), [`3bab027`](https://github.com/marco-lepore/yage/commit/3bab0271c916cd65f7e7dbe17388f7f7cedf20ff), [`851310c`](https://github.com/marco-lepore/yage/commit/851310c54e04f5cdb52819050ca0a50f36b8e4c3), [`ba12b2f`](https://github.com/marco-lepore/yage/commit/ba12b2f0f851c2472abed23878b9598e57024d5f), [`3bab027`](https://github.com/marco-lepore/yage/commit/3bab0271c916cd65f7e7dbe17388f7f7cedf20ff), [`5efe5f6`](https://github.com/marco-lepore/yage/commit/5efe5f6de138b71048e6f4752ed74647a9fc3e76), [`d6b8138`](https://github.com/marco-lepore/yage/commit/d6b813836696a1b8afd8f6cdf7ae1ddaf83f94e8), [`d6b8138`](https://github.com/marco-lepore/yage/commit/d6b813836696a1b8afd8f6cdf7ae1ddaf83f94e8), [`7ac9d9d`](https://github.com/marco-lepore/yage/commit/7ac9d9d0fd806e5ebd552b92ef9df7eb9b897210)]:
  - @yagejs/core@0.12.0
  - @yagejs/renderer@0.12.0

## 0.11.0

### Minor Changes

- [#304](https://github.com/marco-lepore/yage/pull/304) [`daa8214`](https://github.com/marco-lepore/yage/commit/daa821458a69d14176f5c5aebc3f4204348ddb0c) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Remove automatic serialization from light sources and occluders. Store durable
  lighting values in an explicit game save root and rebuild components with the
  scene.

- [#342](https://github.com/marco-lepore/yage/pull/342) [`72c2d67`](https://github.com/marco-lepore/yage/commit/72c2d6752afd33de8e616626d436b4b85d4512bf) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Raise the PixiJS peer floor from `^8.5.0` to `^8.8.0`.

  **Breaking:** a game on PixiJS 8.5 to 8.7 must upgrade to 8.8 or newer.

  `textureSpace`, the Graphics fill property that selects how a texture or a
  gradient maps onto a shape, does not exist before PixiJS 8.8.0. Older versions
  ignore it, so the `space` option on `linearGradient` and `radialGradient` has
  no effect there and the gradient renders in whichever mapping that version
  applies. The old floor admitted versions the engine has never supported.

### Patch Changes

- [#329](https://github.com/marco-lepore/yage/pull/329) [`8d7b5e3`](https://github.com/marco-lepore/yage/commit/8d7b5e3fe395898c7f4cbde0b352acc2713e6559) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add caller-owned vector buffers and coordinate reads without Vec2 construction.
  - Add `getPositionInto` to light sources and occluders.
  - Reuse coordinate buffers in light-level queries and overlay camera projection.

- Updated dependencies [[`d2adfed`](https://github.com/marco-lepore/yage/commit/d2adfedb0e5d15269fe941a3a24f23ddb0126aa4), [`d951322`](https://github.com/marco-lepore/yage/commit/d951322da3dff3adfc532732f1578cc6f1149fa7), [`dc42ba4`](https://github.com/marco-lepore/yage/commit/dc42ba40cd3bbd04c8ff27bf4e8721f274dde034), [`dc42ba4`](https://github.com/marco-lepore/yage/commit/dc42ba40cd3bbd04c8ff27bf4e8721f274dde034), [`56570ae`](https://github.com/marco-lepore/yage/commit/56570ae539b98d2eefa000898c71eabea28df571), [`daa8214`](https://github.com/marco-lepore/yage/commit/daa821458a69d14176f5c5aebc3f4204348ddb0c), [`daa8214`](https://github.com/marco-lepore/yage/commit/daa821458a69d14176f5c5aebc3f4204348ddb0c), [`c105024`](https://github.com/marco-lepore/yage/commit/c105024b5402c11dc36da52b08f6ab39354da8a5), [`c8ad215`](https://github.com/marco-lepore/yage/commit/c8ad215530681caeb63484cc07b118cd977a5ba5), [`08b0d06`](https://github.com/marco-lepore/yage/commit/08b0d06b63a44a51bd6f8e8308574fd41c96af59), [`08b0d06`](https://github.com/marco-lepore/yage/commit/08b0d06b63a44a51bd6f8e8308574fd41c96af59), [`33d00e3`](https://github.com/marco-lepore/yage/commit/33d00e37801a300710cc10de0352b1aa1b1ba2f1), [`1b12043`](https://github.com/marco-lepore/yage/commit/1b120433e9570b21f5748c8cfaaf98bc781c4a62), [`7275620`](https://github.com/marco-lepore/yage/commit/7275620756183b22de3df1009e1e07615db9b40e), [`4bab66f`](https://github.com/marco-lepore/yage/commit/4bab66f0e34a387155bbc7168b048dcac167525f), [`cfde97d`](https://github.com/marco-lepore/yage/commit/cfde97de2c94416cb5bbab26a12f9c290e6b66cf), [`47bf729`](https://github.com/marco-lepore/yage/commit/47bf7297056a506d5d21cbedaa3568a363d22051), [`9b9fe07`](https://github.com/marco-lepore/yage/commit/9b9fe07d7f32219c0e9aa37265b526cdc5924ce8), [`9e194ec`](https://github.com/marco-lepore/yage/commit/9e194ec386a74c0f1ad5699c3c0db183aa86f1b1), [`9e194ec`](https://github.com/marco-lepore/yage/commit/9e194ec386a74c0f1ad5699c3c0db183aa86f1b1), [`05492cb`](https://github.com/marco-lepore/yage/commit/05492cb8e27f89fe82fedd6e307afa2f90d1f68f), [`05492cb`](https://github.com/marco-lepore/yage/commit/05492cb8e27f89fe82fedd6e307afa2f90d1f68f), [`56570ae`](https://github.com/marco-lepore/yage/commit/56570ae539b98d2eefa000898c71eabea28df571), [`aed53f7`](https://github.com/marco-lepore/yage/commit/aed53f7f5679f824846dee3c55c0342f7f07cf98), [`72c2d67`](https://github.com/marco-lepore/yage/commit/72c2d6752afd33de8e616626d436b4b85d4512bf), [`ba57361`](https://github.com/marco-lepore/yage/commit/ba5736175e8b3e06157e680b4b66d10eb8d06823), [`aa5b78e`](https://github.com/marco-lepore/yage/commit/aa5b78e18b56d17bdca4ffb8299c8ea83979e05a), [`439d0e2`](https://github.com/marco-lepore/yage/commit/439d0e205228bee15d8d79607abdba5731b0873b), [`1b12043`](https://github.com/marco-lepore/yage/commit/1b120433e9570b21f5748c8cfaaf98bc781c4a62), [`56570ae`](https://github.com/marco-lepore/yage/commit/56570ae539b98d2eefa000898c71eabea28df571), [`aaf1279`](https://github.com/marco-lepore/yage/commit/aaf1279455bc655681cf15c8edc64b1407b2a823), [`8064fa6`](https://github.com/marco-lepore/yage/commit/8064fa64099feeb1d164360b668e0721a14b7bbe), [`8064fa6`](https://github.com/marco-lepore/yage/commit/8064fa64099feeb1d164360b668e0721a14b7bbe), [`8f11936`](https://github.com/marco-lepore/yage/commit/8f119362281bf31ab59b8b907816886922aaf18f), [`b087462`](https://github.com/marco-lepore/yage/commit/b087462ab2ae27bebb7ce274402c9e278f6d472a), [`8bb9e0b`](https://github.com/marco-lepore/yage/commit/8bb9e0b905017ac724f70fc8fe55014605563e88), [`8d7b5e3`](https://github.com/marco-lepore/yage/commit/8d7b5e3fe395898c7f4cbde0b352acc2713e6559), [`8d7b5e3`](https://github.com/marco-lepore/yage/commit/8d7b5e3fe395898c7f4cbde0b352acc2713e6559), [`b64cd45`](https://github.com/marco-lepore/yage/commit/b64cd453a65a83899b9e8d5fecf4ad43bf1eb3d4), [`ff52a8a`](https://github.com/marco-lepore/yage/commit/ff52a8a4816b18f7de5309ab08606183db67e071)]:
  - @yagejs/renderer@0.11.0
  - @yagejs/core@0.11.0

## 0.10.4

### Patch Changes

- Updated dependencies [[`7a0d56e`](https://github.com/marco-lepore/yage/commit/7a0d56e3540e246673353b7b6facfeebedb2a51f), [`753050b`](https://github.com/marco-lepore/yage/commit/753050b08270af8a73f694e27ca886613c1b57fa)]:
  - @yagejs/core@0.10.4
  - @yagejs/renderer@0.10.4

## 0.10.3

### Patch Changes

- Updated dependencies [[`3cb9d19`](https://github.com/marco-lepore/yage/commit/3cb9d190e4720816c7ba83a1e6fafd4b05d2684e), [`6dc493e`](https://github.com/marco-lepore/yage/commit/6dc493e32c8a20e928621490c1308f99324e7208), [`d337ce3`](https://github.com/marco-lepore/yage/commit/d337ce3a0a8eddce46117d7ff17eabbb6f2d03b3), [`f106e5d`](https://github.com/marco-lepore/yage/commit/f106e5d3bcc0f8a6a8aa449fee9a0f9c187b4d35), [`6eaad69`](https://github.com/marco-lepore/yage/commit/6eaad6992b0923ec194e3d5e5c3f1eb812afbee8), [`83c9993`](https://github.com/marco-lepore/yage/commit/83c999385c645f158dc3ef7a8cdd995fd9f2b37c), [`31d6435`](https://github.com/marco-lepore/yage/commit/31d6435fd4260363988603fdc2e292478247e314)]:
  - @yagejs/core@0.10.3
  - @yagejs/renderer@0.10.3

## 0.10.2

### Patch Changes

- Updated dependencies [[`97ace87`](https://github.com/marco-lepore/yage/commit/97ace87237bc63accd0b0ffb840e03c51a2bb5b6), [`ef27ea3`](https://github.com/marco-lepore/yage/commit/ef27ea3d1ff31faea4fa77fd6538bd8cadabe606), [`e30b114`](https://github.com/marco-lepore/yage/commit/e30b114d416a211144463540fc6577e6abc6c1e9), [`e30b114`](https://github.com/marco-lepore/yage/commit/e30b114d416a211144463540fc6577e6abc6c1e9), [`7f0b764`](https://github.com/marco-lepore/yage/commit/7f0b76494d72bd94866436ee46a5669c08d60372), [`b29d234`](https://github.com/marco-lepore/yage/commit/b29d2342218cc899a3d286f964bb7876f81ae49d), [`7002ce8`](https://github.com/marco-lepore/yage/commit/7002ce8d35e7a10c384496fcef166884fed5e0b4)]:
  - @yagejs/renderer@0.10.2
  - @yagejs/core@0.10.2

## 0.10.1

### Patch Changes

- Updated dependencies [[`d3a730b`](https://github.com/marco-lepore/yage/commit/d3a730b1dfae45338a53ddcc1267ae3e4102a34a), [`ccc0d71`](https://github.com/marco-lepore/yage/commit/ccc0d71c7f1ae4197b56a5469f61ae4145045391), [`50cc882`](https://github.com/marco-lepore/yage/commit/50cc8825c4365165a5ebfafbb6353c26660daa23)]:
  - @yagejs/core@0.10.1
  - @yagejs/renderer@0.10.1

## 0.10.0

### Minor Changes

- [#221](https://github.com/marco-lepore/yage/pull/221) [`83733d8`](https://github.com/marco-lepore/yage/commit/83733d8b2af4251b8765c2cbe015d27c9d3c4325) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add the optional `@yagejs/lighting` engine package.
  - Add serializable radial light and occluder components with per-scene ownership.
  - Add continuous additive `levelAt()` queries for gameplay.
  - Add a soft multiply-overlay renderer, configurable query-only mode, and a per-scene custom renderer contract.

### Patch Changes

- Updated dependencies [[`34d45fd`](https://github.com/marco-lepore/yage/commit/34d45fd690d747b7d8dd36a5972ef20d21d574da), [`f48983d`](https://github.com/marco-lepore/yage/commit/f48983dbb4e43c25b455ac3f96e7d8684266bbc3), [`f48983d`](https://github.com/marco-lepore/yage/commit/f48983dbb4e43c25b455ac3f96e7d8684266bbc3), [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be), [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be), [`f1048ab`](https://github.com/marco-lepore/yage/commit/f1048ab756feee84e593609521c3a58fcfc1c1a7), [`4a5b3b6`](https://github.com/marco-lepore/yage/commit/4a5b3b639ddcbb285b6a4733b89d27bcee14c50c), [`d459026`](https://github.com/marco-lepore/yage/commit/d4590265b9aa5297fb99d20b92bb5a2f19cac0c5), [`8400b55`](https://github.com/marco-lepore/yage/commit/8400b5519cb3401a0ad91ab1be511e3d885cc203), [`81eafe0`](https://github.com/marco-lepore/yage/commit/81eafe04c3b362832e2dc873bea996f36f4601fd)]:
  - @yagejs/core@0.10.0
  - @yagejs/renderer@0.10.0

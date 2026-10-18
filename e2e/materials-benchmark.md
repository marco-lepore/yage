# Sprite materials measurements

The functional material implementation is verified on WebGL2 and WebGPU. The
performance pass reduces the 500-sprite benchmark from 502 draws to 3. The
eight-light WebGL case meets the proposed added CPU budget, but its added GPU
cost remains slightly above the 4 ms target. These measurements are not a
frame-rate guarantee.

## Recorded run

Measured before and after optimization on 2026-10-18, Apple M4, macOS 15.6,
Chromium 148.0.7778.96, PixiJS 8.17.1.
WebGL used ANGLE's Metal backend; WebGPU reported Apple / metal-3. The worktree
contained the material implementation on top of `01c942ca`.

Each case uses a 1280×720 render target at resolution 1, 500 visible 32×32
sprites, and 16 box occluders. Eight lights of radius 800 overlap much of the
scene. All lights have `size: 0`, height 64, and intensity 0.2. The stress case
uses 32 lights. The overlap case packs sprites eight
pixels apart and gives them alpha 0.5. The ordinary baseline has the same
entities but no maps or material draw path and selects a null lighting backend.

Before optimization:

| Backend | Case                          | CPU median (ms) | CPU p95 (ms) | GPU median (ms) | Draws/frame |
| ------- | ----------------------------- | --------------: | -----------: | --------------: | ----------: |
| WebGL2  | Ordinary                      |            1.20 |         1.50 |           0.254 |           3 |
| WebGL2  | Mapped, 8 lights              |            3.40 |         6.10 |           7.949 |         502 |
| WebGL2  | Translucent overlap, 8 lights |            4.30 |         6.80 |          12.667 |         502 |
| WebGL2  | Mapped, 32 lights             |            5.60 |         7.20 |          22.427 |         502 |
| WebGPU  | Ordinary                      |            0.10 |         0.20 |     Unavailable |           3 |
| WebGPU  | Mapped, 8 lights              |            1.80 |         3.00 |     Unavailable |         502 |
| WebGPU  | Translucent overlap, 8 lights |            2.00 |         3.00 |     Unavailable |         502 |
| WebGPU  | Mapped, 32 lights             |            3.50 |         7.00 |     Unavailable |         502 |

After optimization:

| Backend | Case                          | CPU median (ms) | CPU p95 (ms) | GPU median (ms) | Draws/frame |
| ------- | ----------------------------- | --------------: | -----------: | --------------: | ----------: |
| WebGL2  | Ordinary                      |            1.10 |         1.40 |           0.236 |           3 |
| WebGL2  | Mapped, 8 lights              |            1.70 |         2.10 |           4.457 |           3 |
| WebGL2  | Translucent overlap, 8 lights |            1.80 |         2.30 |           7.949 |           3 |
| WebGL2  | Mapped, 32 lights             |            1.80 |         2.10 |          12.330 |           3 |
| WebGPU  | Ordinary                      |            0.10 |         0.20 |     Unavailable |           3 |
| WebGPU  | Mapped, 8 lights              |            0.20 |         0.30 |     Unavailable |           3 |
| WebGPU  | Translucent overlap, 8 lights |            0.20 |         0.30 |     Unavailable |           3 |
| WebGPU  | Mapped, 32 lights             |            1.40 |         2.00 |     Unavailable |           3 |

The proposed targets were less than 2 ms added CPU time and less than 4 ms
added GPU time for the eight-light case. After optimization, WebGL adds
0.60 ms median CPU and 4.221 ms median GPU time over ordinary sprites. WebGPU
adds 0.10 ms median CPU; its GPU target is unverified.
Runs vary with device load and power state. These numbers describe one run,
not a statistically established capacity limit.

Compatible adjacent material sprites now share a draw without changing their
order. Transform, tint, alpha, normal orientation, and atlas frame remain
individual. Material values, texture pages, lighting provider, blend mode,
filters, masks, and intervening draw instructions can split a batch. The
benchmark uses compatible sprites, so its draw reduction is the best case for
batching, not a prediction for every game.

Both GPU lighting backends use direct intersections for point-light shadows
and reject edges outside the pixel-to-lamp region before soft-shadow
projection. Surface shading skips shadow work for back-facing lights and skips
specular work for fully shadowed pixels. Finite-size lights still use the
shared soft-shadow coverage calculation. Their cost is not measured by this
point-light benchmark; normal orientation also affects how much work is skipped.

Each case warms up for 60 frames and measures 120 frames. CPU time covers one
Inspector-controlled engine step, including draw submission. GPU completion
is awaited outside that interval. WebGL uses `EXT_disjoint_timer_query_webgl2`,
waits for each query to become available before the next sample, and discards
disjoint samples. The WebGPU device does not enable timestamp queries. GPU
memory is reported as null on both backends because the browser provides no
portable measurement. Completion waits are never substituted for GPU timing.

## Reproduce

Build the packages first. Run the opt-in benchmark by itself, with one worker,
and keep other GPU workloads idle:

```sh
npx turbo build --filter='./packages/*'
YAGE_MATERIAL_BENCHMARK=1 npx playwright test e2e/specs/materials-benchmark.spec.ts --project=fixtures --workers=1 --reporter=line
```

The test prints and attaches JSON containing hardware, browser, timings, draw
counts, and missing measurements. It is skipped in ordinary test runs. A passing
benchmark test means the selected backend ran and produced measurements; it does
not assert a device-independent timing threshold.

Correctness is covered separately by `e2e/specs/materials.spec.ts`. Those tests
use numeric GPU samples through Inspector extensions, including transparent draw
order, native blend-mode parity, map frame/atlas alignment, masks and filters,
scene stacking, and repeated source/scene disposal. Batch results are compared
with separately drawn sprites, including mirrored transforms and tint/alpha.
Point-shadow checks cover box and circle blockers inside and outside the light
segment on both backends. The shared soft-shadow and compositor tests also run
on both backends.

On Linux CI, the correctness suite requests Chromium's SwiftShader adapter
with the flags used in its [WebGPU test configuration](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/web_tests/FlagSpecificConfig).
That configuration was not executed on the Mac used for this report. The
hardware benchmark does not force a software adapter.

## Delivery boundary

The implementation delivers the sprite API, map loading, animation,
diffuse/specular/emission shading, existing composition behavior, and adjacent
material batching. The original 500-sprite performance gate is still unmet
because the added WebGL GPU cost exceeds 4 ms. The overlap and 32-light cases
remain substantially more expensive, and WebGPU GPU time is unmeasured.

Further GPU work should target repeated light and shadow evaluation while
preserving separate surface normals, scene isolation, and shared shadow
behavior. These measurements must accompany any release assessment.

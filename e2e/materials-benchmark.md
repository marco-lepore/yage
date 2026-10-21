# Sprite materials measurements

`e2e/specs/materials-benchmark.spec.ts` measures the CPU and GPU time that
`surfaceLighting()` adds to a scene of mapped sprites. It is opt-in and asserts
no timing threshold: a passing run means the selected backend ran and produced
measurements. These numbers describe one device, not a frame-rate
guarantee.

## Test scene

Each case uses a 1280×720 render target at resolution 1, 500 visible 32×32
sprites, and 16 box occluders. Eight lights of radius 800 overlap most of the
scene. Every light has `size: 0`, height 64, and intensity 0.2.

| Case                          | Setup                                                                   |
| ----------------------------- | ----------------------------------------------------------------------- |
| Ordinary                      | The same entities with no maps or material, and a null lighting backend |
| Mapped, 8 lights              | Every sprite has a normal map and a lit material                        |
| Translucent overlap, 8 lights | Sprites packed 8 pixels apart with alpha 0.5                            |
| Mapped, 32 lights             | The mapped case with 32 lights                                          |

All sprites share one image page and one material, so adjacent sprites share a
draw call. That is the best case for batching. A game with varied images,
materials, and draw order makes more draw calls.

## Recorded run

Recorded on 2026-10-22: Apple M4, macOS 15.6, Chromium 148.0.7778.96,
PixiJS 8.17.1. WebGL used ANGLE's Metal backend; WebGPU reported Apple /
metal-3. The benchmark ran three times in a row, and each value is the median
of the three runs.

| Backend | Case                          | CPU median (ms) | CPU p95 (ms) | GPU median (ms) | Draws/frame |
| ------- | ----------------------------- | --------------: | -----------: | --------------: | ----------: |
| WebGL2  | Ordinary                      |            1.20 |         1.60 |           0.292 |           3 |
| WebGL2  | Mapped, 8 lights              |            1.70 |         2.30 |           8.109 |           3 |
| WebGL2  | Translucent overlap, 8 lights |            1.70 |         2.20 |           9.257 |           3 |
| WebGL2  | Mapped, 32 lights             |            1.80 |         2.30 |          12.649 |           3 |
| WebGPU  | Ordinary                      |            0.10 |         0.20 |     Unavailable |           3 |
| WebGPU  | Mapped, 8 lights              |            0.20 |         0.30 |     Unavailable |           3 |
| WebGPU  | Translucent overlap, 8 lights |            0.20 |         0.30 |     Unavailable |           3 |
| WebGPU  | Mapped, 32 lights             |            0.30 |         0.50 |     Unavailable |           3 |

Over the ordinary case, eight lights add 0.50 ms median CPU time and 7.817 ms
median GPU time on WebGL2, and 0.10 ms median CPU time on WebGPU. GPU time
grows with the number of lights and with overlap, because every lit pixel
evaluates every light and every overlapping sprite is lit again.

The WebGL2 GPU medians varied between the three runs: by 0.17 ms in the mapped
8-light case, 2.79 ms in the overlap case, and 2.92 ms in the 32-light case.
Repeat the benchmark before comparing two measurements.

## Method

Each case warms up for 60 frames and measures 120. CPU time covers one
Inspector-controlled engine step, including draw submission. GPU completion is
awaited outside that interval. WebGL uses `EXT_disjoint_timer_query_webgl2`,
waits for each query to become available before the next sample, and discards
disjoint samples. The WebGPU device does not enable timestamp queries, so its
GPU time is unavailable. GPU memory is reported as null on both backends,
because browsers provide no portable measurement.

## Reproduce

Build the packages first. Run the benchmark by itself, with one worker, and
keep other GPU work idle:

```sh
npx turbo build --filter='./packages/*'
YAGE_MATERIAL_BENCHMARK=1 npx playwright test e2e/specs/materials-benchmark.spec.ts --project=fixtures --workers=1 --reporter=line
```

The test prints and attaches JSON with the hardware, browser, timings, draw
counts, and any missing measurement.

## Correctness checks

`e2e/specs/materials.spec.ts` checks rendered pixels through Inspector
extensions on WebGL2 and WebGPU. It covers point-light shadows from box and
circle blockers, transparent draw order, blend-mode parity with ordinary
sprites, map alignment for sheet and atlas frames, masks and filters, scene
stacking, repeated source and scene replacement, and batched draws compared
with separate ones.

On Linux CI the spec starts Chromium with its SwiftShader WebGPU adapter and
SwiftShader Vulkan, so the WebGPU checks run without a hardware GPU. The
benchmark does not force a software adapter, and those runs check
correctness only.

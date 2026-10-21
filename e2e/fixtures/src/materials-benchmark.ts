import {
  Component,
  Engine,
  Entity,
  InspectorKey,
  Scene,
  Transform,
  Vec2,
} from "@yagejs/core";
import {
  RendererKey,
  RendererPlugin,
  SpriteComponent,
  dataTexture,
  litMaterial,
  texture,
} from "@yagejs/renderer";
import {
  LightOccluder,
  LightSource,
  LightingPlugin,
  surfaceLighting,
} from "@yagejs/lighting";
import { DebugPlugin } from "@yagejs/debug";
import { setupContainer } from "./shared.js";

const params = new URLSearchParams(location.search);
const ordinary = params.has("ordinary");
const overlap = params.has("overlap");
const lightCount = params.has("stress") ? 32 : 8;
const color = texture("/material-assets/gray.png");
const normal = dataTexture("/material-assets/right.png");
const material = litMaterial({ specularStrength: 0.25 });

class Tile extends Entity {
  setup(index: number): void {
    const columns = overlap ? 10 : 40;
    const spacing = overlap ? 8 : 32;
    this.add(
      new Transform({
        position: new Vec2(
          (index % columns) * spacing,
          Math.floor(index / columns) * (overlap ? 8 : 40),
        ),
      }),
    );
    this.add(
      new SpriteComponent({
        texture: color,
        alpha: overlap ? 0.5 : 1,
        ...(ordinary ? {} : { maps: { normal }, material }),
      }),
    );
  }
}
class Lamp extends Entity {
  setup(index: number): void {
    this.add(
      new Transform({
        position: new Vec2(
          160 + (index % 4) * 280,
          160 + Math.floor(index / 4) * 50,
        ),
      }),
    );
    this.add(new LightSource({ radius: 800, height: 64, intensity: 0.2 }));
  }
}
class Wall extends Entity {
  setup(index: number): void {
    this.add(
      new Transform({
        position: new Vec2(
          80 + (index % 8) * 150,
          220 + Math.floor(index / 8) * 200,
        ),
      }),
    );
    this.add(
      new LightOccluder({ shape: { type: "box", width: 12, height: 40 } }),
    );
  }
}
class BenchmarkProbe extends Component {
  onAdd(): void {
    const plugin = this.use(RendererKey);
    const inspector = this.use(InspectorKey);
    const renderer = plugin.application.renderer;
    let draws = 0;
    if ("gl" in renderer) {
      const original = renderer.geometry.draw.bind(renderer.geometry);
      renderer.geometry.draw = (...args) => {
        draws++;
        return original(...args);
      };
    } else if ("gpu" in renderer) {
      const original = renderer.encoder.beginRenderPass.bind(renderer.encoder);
      renderer.encoder.beginRenderPass = (...args) => {
        original(...args);
        const pass = renderer.encoder.renderPassEncoder;
        const draw = pass.drawIndexed.bind(pass);
        pass.drawIndexed = (...values) => {
          draws++;
          return draw(...values);
        };
      };
    }
    inspector.addExtension("materials-benchmark", {
      measure: async () => {
        const frames = 120;
        for (let i = 0; i < 60; i++) inspector.time.step();
        const timings: number[] = [];
        const gpuTimings: number[] = [];
        const gl =
          "gl" in renderer
            ? (renderer.gl as WebGL2RenderingContext)
            : undefined;
        const timer = gl?.getExtension("EXT_disjoint_timer_query_webgl2") as
          | { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }
          | null
          | undefined;
        draws = 0;
        for (let i = 0; i < frames; i++) {
          const query = timer && gl ? gl.createQuery() : null;
          if (query && timer && gl)
            gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
          const start = performance.now();
          inspector.time.step();
          timings.push(performance.now() - start);
          if (query && timer && gl) gl.endQuery(timer.TIME_ELAPSED_EXT);
          // Allow submitted GPU work to finish between samples. This wait is
          // excluded from CPU timing; it is not reported as GPU execution time.
          if ("gpu" in renderer)
            await renderer.gpu.device.queue.onSubmittedWorkDone();
          else if ("gl" in renderer) renderer.gl.finish();
          if (query && timer && gl) {
            while (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE))
              await new Promise(requestAnimationFrame);
            if (!gl.getParameter(timer.GPU_DISJOINT_EXT))
              gpuTimings.push(
                Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / 1e6,
              );
            gl.deleteQuery(query);
          }
        }
        timings.sort((a, b) => a - b);
        gpuTimings.sort((a, b) => a - b);
        const hardware =
          "gpu" in renderer
            ? {
                vendor: renderer.gpu.adapter.info.vendor,
                architecture: renderer.gpu.adapter.info.architecture,
                device: renderer.gpu.adapter.info.device,
                description: renderer.gpu.adapter.info.description,
              }
            : "gl" in renderer
              ? renderer.gl.getParameter(
                  renderer.gl.getExtension("WEBGL_debug_renderer_info")
                    ?.UNMASKED_RENDERER_WEBGL ?? renderer.gl.RENDERER,
                )
              : null;
        return {
          drawCallsPerFrame: draws / frames,
          medianGpuMs: gpuTimings[Math.floor(gpuTimings.length / 2)] ?? null,
          gpuMemoryBytes: null,
          backend: renderer.name,
          ordinary,
          overlap,
          lights: lightCount,
          sprites: 500,
          occluders: 16,
          frames,
          warmup: 60,
          medianCpuMs: timings[60],
          p95CpuMs: timings[114],
          hardware,
          browser: navigator.userAgent,
        };
      },
    });
  }
}
class BenchmarkScene extends Scene {
  readonly name = "materials-benchmark";
  readonly preload = [color, normal];
  readonly lighting = { renderer: ordinary ? "none" : "surface" };
  onEnter(): void {
    for (let i = 0; i < 500; i++) this.spawn(Tile, i);
    for (let i = 0; i < lightCount; i++) this.spawn(Lamp, i);
    for (let i = 0; i < 16; i++) this.spawn(Wall, i);
    this.spawn("probe").add(new BenchmarkProbe());
  }
}
const engine = new Engine({ debug: true });
engine.use(
  new RendererPlugin({
    width: 1280,
    height: 720,
    resolution: 1,
    container: setupContainer(1280, 720),
    pixelArtPreset: true,
    pixi: {
      preference: params.get("backend") === "webgpu" ? "webgpu" : "webgl",
    },
  }),
);
engine.use(
  new LightingPlugin({
    ambient: { level: 0.1 },
    renderers: { surface: surfaceLighting(), none: null },
    defaultRenderer: "surface",
  }),
);
engine.use(new DebugPlugin({ startFrozen: true }));
await engine.start();
await engine.scenes.push(new BenchmarkScene());
engine.context.resolve(InspectorKey).time.step();

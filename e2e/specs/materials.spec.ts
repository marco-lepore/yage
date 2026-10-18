import { expect, test, type Page } from "@playwright/test";
import { gotoFixture } from "./helpers.js";

async function openMaterials(page: Page, backend: string): Promise<void> {
  await gotoFixture(page, `/materials.html?backend=${backend}`);
  await page.waitForFunction(
    () => window.__yage__?.inspector.getExtension("materials") !== undefined,
  );
}

interface MaterialProbe {
  backend(): string;
  atlas(): void;
  clearMaps(): void;
  assets(): Promise<Record<string, boolean>>;
  replaceScene(): Promise<void>;
  pushScene(): Promise<void>;
  popScene(): Promise<void>;
  pixel(x: number, y: number): number[];
  realSprites(): boolean[];
  frame(frame: number): void;
  overlap(): void;
  darkness(): void;
  emission(): void;
  alpha(alpha: number): void;
  mask(): void;
  filter(): void;
  layerFilter(): void;
  sceneFilter(): void;
  mirror(): void;
  rotate(): void;
  camera(): void;
  screen(x: number, y: number): { x: number; y: number };
  shadow(): void;
  level(): number;
  cone(): void;
  specular(): void;
  flat(): void;
  height(value: number): void;
  emissionMap(): void;
  specularMap(): void;
  normalY(value: "up" | "down"): void;
  tint(): void;
  additive(): void;
  unlit(): void;
  reverseOrder(): void;
  aboveEffects(): void;
  hide(): void;
  show(): void;
  scale(x: number, y: number): void;
  batch(): void;
  separateBatch(): void;
  replaceBatchMaterial(): void;
  pointBlocker(shape: "box" | "circle", x: number, y: number): void;
}

test.use({
  launchOptions: {
    args: [
      "--enable-gpu",
      "--ignore-gpu-blocklist",
      ...(process.platform === "darwin" ? ["--use-angle=metal"] : []),
      ...(process.platform === "linux" && process.env["CI"]
        ? [
            "--enable-unsafe-webgpu",
            "--use-webgpu-adapter=swiftshader",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
          ]
        : []),
    ],
  },
});

for (const backend of ["webgl", "webgpu"]) {
  for (const shape of ["box", "circle"] as const) {
    for (const [x, y, shadowed] of [
      [76, 48, true],
      [76, 84, false],
      [16, 48, false],
      [128, 48, false],
    ] as const) {
      test(`point-light ${shape} at ${x},${y} matches the query on ${backend}`, async ({
        page,
      }) => {
        await openMaterials(page, backend);
        const result = await page.evaluate(
          ({ shape, x, y }) => {
            const inspector = window.__yage__!.inspector;
            const probe = inspector.getExtension<MaterialProbe>("materials")!;
            probe.pointBlocker(shape, x, y);
            inspector.time.step();
            return { level: probe.level(), red: probe.pixel(48, 48)[0]! };
          },
          { shape, x, y },
        );
        if (shadowed) {
          expect(result.level).toBe(0);
          expect(result.red).toBeLessThan(3);
        } else {
          expect(result.level).toBeGreaterThan(0.5);
          expect(result.red).toBeGreaterThan(60);
        }
      });
    }
  }
  test(`batched tint, alpha and nonuniform mirroring match separate draws on ${backend}`, async ({
    page,
  }) => {
    await openMaterials(page, backend);
    const result = await page.evaluate(() => {
      const inspector = window.__yage__!.inspector;
      const probe = inspector.getExtension<MaterialProbe>("materials")!;
      probe.batch();
      inspector.time.step();
      const samples = () => [
        probe.pixel(36, 48),
        probe.pixel(48, 48),
        probe.pixel(68, 72),
      ];
      const batched = samples();
      // A pass-through filter forces a draw boundary without changing appearance.
      probe.separateBatch();
      inspector.time.step();
      return { batched, separate: samples(), errors: inspector.getErrors() };
    });
    expect(result.batched[0]![0]).toBeGreaterThan(30);
    expect(result.batched).toEqual(result.separate);
    expect(result.errors.callbackErrors).toEqual([]);
  });

  test(`material changes split cached batches on ${backend}`, async ({
    page,
  }) => {
    await openMaterials(page, backend);
    const result = await page.evaluate(() => {
      const inspector = window.__yage__!.inspector;
      const probe = inspector.getExtension<MaterialProbe>("materials")!;
      probe.batch();
      inspector.time.step();
      const before = [probe.pixel(36, 48), probe.pixel(68, 72)];
      probe.replaceBatchMaterial();
      inspector.time.step();
      return { before, after: [probe.pixel(36, 48), probe.pixel(68, 72)] };
    });
    expect(result.after[0]).toEqual(result.before[0]);
    expect(result.after[1]![1]).toBeGreaterThan(result.before[1]![1]! + 20);
  });

  test(`specular masks and green-channel convention on ${backend}`, async ({
    page,
  }) => {
    await openMaterials(page, backend);
    const result = await page.evaluate(() => {
      const inspector = window.__yage__!.inspector;
      const probe = inspector.getExtension<MaterialProbe>("materials")!;
      probe.flat();
      inspector.time.step();
      const base = [probe.pixel(40, 48)[0]!, probe.pixel(56, 48)[0]!];
      probe.specularMap();
      inspector.time.step();
      const masked = [probe.pixel(40, 48)[0]!, probe.pixel(56, 48)[0]!];
      probe.normalY("up");
      inspector.time.step();
      const up = probe.pixel(48, 48)[0]!;
      probe.normalY("down");
      inspector.time.step();
      return { base, masked, up, down: probe.pixel(48, 48)[0]! };
    });
    expect(result.masked[0]).toBe(result.base[0]);
    expect(result.masked[1]).toBeGreaterThan(result.base[1]! + 40);
    expect(result.up).toBeGreaterThan(50);
    expect(result.down).toBeLessThan(3);
  });

  test(`tint, alpha, additive blending and draw order on ${backend}`, async ({
    page,
  }) => {
    await openMaterials(page, backend);
    const result = await page.evaluate(() => {
      const inspector = window.__yage__!.inspector;
      const probe = inspector.getExtension<MaterialProbe>("materials")!;
      probe.unlit();
      probe.tint();
      probe.overlap();
      inspector.time.step();
      const behind = probe.pixel(48, 48);
      probe.reverseOrder();
      inspector.time.step();
      const front = probe.pixel(48, 48);
      probe.alpha(0.5);
      probe.additive();
      inspector.time.step();
      const additive = probe.pixel(48, 48);
      const nativeAdditive = probe.pixel(48, 96);
      probe.alpha(0);
      inspector.time.step();
      return {
        behind,
        front,
        additive,
        nativeAdditive,
        zero: probe.pixel(48, 48),
      };
    });
    expect(result.front.slice(0, 3)).toEqual([128, 0, 0]);
    expect(result.behind.slice(0, 3)).toEqual([64, 0, 0]);
    expect(result.additive).toEqual(result.nativeAdditive);
    expect(result.zero.slice(0, 3)).toEqual([0, 0, 0]);
  });

  test(`activation, zero scale and drawing above effects on ${backend}`, async ({
    page,
  }) => {
    await openMaterials(page, backend);
    const result = await page.evaluate(() => {
      const inspector = window.__yage__!.inspector;
      const probe = inspector.getExtension<MaterialProbe>("materials")!;
      const before = probe.pixel(48, 48)[0]!;
      probe.hide();
      inspector.time.step();
      const hidden = probe.pixel(48, 48)[0]!;
      probe.show();
      probe.scale(0, 1);
      inspector.time.step();
      const zero = probe.pixel(48, 48)[0]!;
      probe.scale(1, 1);
      probe.aboveEffects();
      inspector.time.step();
      return {
        before,
        hidden,
        zero,
        above: probe.pixel(48, 48)[0]!,
        filtered: probe.pixel(128, 48)[0]!,
      };
    });
    expect(result.hidden).toBe(0);
    expect(result.zero).toBe(0);
    expect(result.above).toBe(result.before);
    expect(result.filtered).toBe(0);
  });

  test(`stacked scenes retain separate lights while the lower scene is paused on ${backend}`, async ({
    page,
  }) => {
    await openMaterials(page, backend);
    const result = await page.evaluate(async () => {
      const inspector = window.__yage__!.inspector;
      const probe = inspector.getExtension<MaterialProbe>("materials")!;
      const before = probe.pixel(48, 48);
      await probe.pushScene();
      inspector.time.step();
      const stacked = probe.pixel(48, 48);
      await probe.popScene();
      inspector.time.step();
      return {
        before,
        stacked,
        after: probe.pixel(48, 48),
        errors: inspector.getErrors(),
      };
    });
    expect(result.stacked[0]).toBeCloseTo(result.before[0]! / 2, -0.5);
    expect(result.stacked[1]).toBeGreaterThan(result.stacked[0]! + 60);
    expect(result.after).toEqual(result.before);
    expect(result.errors.callbackErrors).toEqual([]);
  });

  test(`material draw path preserves sprites and numeric maps on ${backend}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    page.on("console", (message) => {
      if (message.type() === "error")
        errors.push(`${message.text()} ${JSON.stringify(message.location())}`);
    });
    await openMaterials(page, backend).catch((error) => {
      throw new Error(`${String(error)}\n${errors.join("\n")}`);
    });
    await page
      .waitForFunction(
        () =>
          window.__yage__?.inspector.getExtension("materials") !== undefined,
        undefined,
        { timeout: 10000 },
      )
      .catch((error) => {
        throw new Error(`${String(error)}\n${errors.join("\n")}`);
      });
    const result = await page.evaluate(() => {
      const inspector = window.__yage__!.inspector;
      const probe = inspector.getExtension<MaterialProbe>("materials")!;
      const first = {
        backend: probe.backend(),
        sprites: probe.realSprites(),
        left: probe.pixel(48, 48),
        right: probe.pixel(128, 48),
        animation: probe.pixel(176, 48),
      };
      probe.frame(1);
      inspector.time.step();
      const nextFrame = probe.pixel(176, 48);
      probe.overlap();
      inspector.time.step();
      const overlap = probe.pixel(48, 48);
      probe.darkness();
      probe.emission();
      probe.alpha(0.5);
      inspector.time.step();
      const emission = probe.pixel(40, 48);
      return { first, nextFrame, overlap, emission };
    });
    expect(result.first.backend).toBe(backend);
    expect(errors).toEqual([]);
    expect(result.first.sprites).toEqual([true, true]);
    expect(result.first.left[0]).toBeGreaterThan(60);
    expect(result.first.right[0]).toBeGreaterThan(60);
    expect(result.first.animation[0]).toBeGreaterThan(50);
    expect(result.nextFrame[0]).toBeLessThan(3);
    expect(result.overlap[0]).toBeCloseTo(result.first.left[0]! / 2, -0.5);
    expect(result.emission[0]).toBeGreaterThan(20);
    expect(result.emission[1]).toBeLessThan(3);
  });
}

for (const backend of ["webgl", "webgpu"]) {
  for (const effect of ["filter", "layerFilter", "sceneFilter"] as const) {
    test(`${effect} and masks retain surface coordinates on ${backend}`, async ({
      page,
    }) => {
      await openMaterials(page, backend);
      const values = await page.evaluate((effect) => {
        const inspector = window.__yage__!.inspector;
        const probe = inspector.getExtension<MaterialProbe>("materials")!;
        const before = probe.pixel(40, 48);
        probe[effect]();
        inspector.time.step();
        const filtered = probe.pixel(40, 48);
        probe.mask();
        inspector.time.step();
        return {
          before,
          filtered,
          inside: probe.pixel(40, 48),
          outside: probe.pixel(56, 48),
        };
      }, effect);
      expect(values.filtered).toEqual(values.before);
      expect(values.inside).toEqual(values.before);
      expect(values.outside[0]).toBeLessThan(3);
    });
  }
  for (const transform of ["mirror", "rotate", "camera"] as const) {
    test(`${transform} transforms mapped normals correctly on ${backend}`, async ({
      page,
    }) => {
      await openMaterials(page, backend);
      const values = await page.evaluate((transform) => {
        const inspector = window.__yage__!.inspector;
        const probe = inspector.getExtension<MaterialProbe>("materials")!;
        const before = probe.pixel(48, 48)[0]!;
        probe[transform]();
        inspector.time.step();
        const screen = probe.screen(48, 48);
        return {
          before,
          after: probe.pixel(Math.floor(screen.x), Math.floor(screen.y))[0]!,
        };
      }, transform);
      expect(values.before).toBeGreaterThan(60);
      if (transform === "camera")
        expect(Math.abs(values.after - values.before)).toBeLessThan(4);
      else expect(values.after).toBeLessThan(3);
    });
  }
  test(`emission survives shadows without affecting light queries on ${backend}`, async ({
    page,
  }) => {
    await openMaterials(page, backend);
    const values = await page.evaluate(() => {
      const inspector = window.__yage__!.inspector;
      const probe = inspector.getExtension<MaterialProbe>("materials")!;
      const lit = probe.pixel(48, 48)[0]!;
      probe.shadow();
      inspector.time.step();
      const shadow = probe.pixel(48, 48)[0]!;
      const level = probe.level();
      probe.emissionMap();
      inspector.time.step();
      return {
        lit,
        shadow,
        level,
        emitted: probe.pixel(48, 48),
        afterLevel: probe.level(),
      };
    });
    expect(values.lit).toBeGreaterThan(60);
    expect(values.shadow).toBeLessThan(3);
    expect(values.level).toBe(0);
    expect(values.afterLevel).toBe(0);
    expect(values.emitted[0]).toBeGreaterThan(120);
    expect(values.emitted[1]).toBeLessThan(3);
  });
  test(`specular adds a highlight and height only changes shading on ${backend}`, async ({
    page,
  }) => {
    await openMaterials(page, backend);
    const values = await page.evaluate(() => {
      const inspector = window.__yage__!.inspector;
      const probe = inspector.getExtension<MaterialProbe>("materials")!;
      probe.flat();
      inspector.time.step();
      const flat = probe.pixel(48, 48)[0]!;
      const level = probe.level();
      probe.specular();
      inspector.time.step();
      const polished = probe.pixel(48, 48)[0]!;
      probe.height(128);
      inspector.time.step();
      const raised = probe.pixel(48, 48)[0]!;
      probe.cone();
      inspector.time.step();
      return {
        flat,
        polished,
        raised,
        level,
        afterLevel: probe.level(),
        outsideCone: probe.pixel(48, 48)[0]!,
      };
    });
    expect(values.polished).toBeGreaterThan(values.flat + 40);
    expect(values.raised).toBeGreaterThan(values.polished);
    expect(values.level).toBeGreaterThan(0.5);
    expect(values.afterLevel).toBe(0);
    expect(values.outsideCone).toBeLessThan(3);
  });
}

for (const backend of ["webgl", "webgpu"]) {
  test(`asset ownership and repeated scene replacement on ${backend}`, async ({
    page,
  }) => {
    await openMaterials(page, backend);
    const assets = await page.evaluate(() =>
      window
        .__yage__!.inspector.getExtension<MaterialProbe>("materials")!
        .assets(),
    );
    expect(assets).toEqual({
      independent: true,
      retained: true,
      isolated: true,
      released: true,
    });
    const samples = await page.evaluate(async () => {
      const inspector = window.__yage__!.inspector;
      const values: number[] = [];
      for (let i = 0; i < 10; i++) {
        await inspector
          .getExtension<MaterialProbe>("materials")!
          .replaceScene();
        inspector.time.step();
        values.push(
          inspector.getExtension<MaterialProbe>("materials")!.pixel(48, 48)[0]!,
        );
      }
      return { values, errors: inspector.getErrors() };
    });
    expect(samples.values[0]).toBeGreaterThan(60);
    expect(samples.values).toEqual(Array(10).fill(samples.values[0]));
    expect(samples.errors.callbackErrors).toEqual([]);
  });
}

for (const backend of ["webgl", "webgpu"]) {
  test(`rotated trimmed atlas frames and source replacement on ${backend}`, async ({
    page,
  }) => {
    await openMaterials(page, backend);
    const result = await page.evaluate(() => {
      const inspector = window.__yage__!.inspector;
      const probe = inspector.getExtension<MaterialProbe>("materials")!;
      probe.atlas();
      inspector.time.step();
      const inside = probe.pixel(176, 54)[0]!;
      const opposite = probe.pixel(176, 38)[0]!;
      const trim = probe.pixel(163, 48)[0]!;
      probe.clearMaps();
      inspector.time.step();
      const flat = probe.pixel(176, 48)[0]!;
      return { inside, opposite, trim, flat };
    });
    expect(result.inside).toBeGreaterThan(50);
    expect(result.opposite).toBeLessThan(3);
    expect(result.trim).toBeLessThan(3);
    expect(result.flat).toBeGreaterThan(15);
    expect(result.flat).toBeLessThan(result.inside - 20);
  });
}

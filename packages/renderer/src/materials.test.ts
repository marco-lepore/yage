// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  Assets,
  BufferImageSource,
  Texture,
  Rectangle,
  UniformGroup,
} from "pixi.js";
import type { Scene } from "@yagejs/core";
import {
  createRendererTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";
import { litMaterial, unlitMaterial } from "./materials.js";
import { SpriteComponent } from "./SpriteComponent.js";
import { AnimationController } from "./AnimationController.js";
import { resolveSpriteSource } from "./spritesheet.js";
import { AnimatedSpriteComponent } from "./AnimatedSpriteComponent.js";
import { dataTexture } from "./dataTexture.js";
import { dataTextureKey } from "./dataTexture.js";
import { registerTexture, unregisterTexture, texture } from "./assets.js";
import { SpriteLightingKey } from "./materials/SpriteLighting.js";
import { resolveMaps } from "./materials/resolveMaps.js";
import type { DataTextureHandle } from "./public-types.js";
import { RendererKey } from "./types.js";

const textures: Texture[] = [];
function image(width = 32, height = 32): Texture {
  const result = new Texture({
    source: new BufferImageSource({
      resource: new Uint8Array(width * height * 4).fill(255),
      width,
      height,
    }),
  });
  textures.push(result);
  return result;
}
/** A scene whose lighting backend shades sprites individually, on WebGL2. */
function surfaceScene(): ReturnType<typeof createRendererTestContext> {
  const context = createRendererTestContext();
  useWebGL2(context.scene);
  context.scene.registerScoped(SpriteLightingKey, {
    kind: "surface",
    glsl: "",
    wgsl: "",
    resources: { lightingUniforms: new UniformGroup({}) },
    gpuLayout: [],
  });
  return context;
}
function useWebGL2(scene: Scene): void {
  Object.assign(scene.context.resolve(RendererKey), {
    application: {
      renderer: { name: "webgl", context: { webGLVersion: 2 } },
    },
  });
}

afterEach(() => {
  for (const key of ["material-color", "material-other", "material-sheet"])
    unregisterTexture(key);
  if (Assets.cache.has("material-atlas")) Assets.cache.remove("material-atlas");
  if (Assets.cache.has(dataTextureKey("normal.png")))
    Assets.cache.remove(dataTextureKey("normal.png"));
  for (const entry of textures.splice(0)) entry.destroy(true);
});

describe("sprite materials", () => {
  it("has immutable defaults, with specular and emission opt-in", () => {
    const lit = litMaterial();
    expect(lit).toEqual({
      kind: "lit",
      normalStrength: 1,
      normalY: "up",
      specularStrength: 0,
      specularColor: 0xffffff,
      shininess: 32,
      emissionIntensity: 0,
      emissionColor: 0xffffff,
    });
    expect(Object.isFrozen(lit)).toBe(true);
    expect(
      unlitMaterial({ emissionColor: "red", emissionIntensity: 1 }),
    ).toEqual({ kind: "unlit", emissionColor: 0xff0000, emissionIntensity: 1 });
  });

  it.each([NaN, Infinity, -Infinity, -1, 1.01])(
    "rejects invalid strengths %s",
    (value) => {
      expect(() => litMaterial({ specularStrength: value })).toThrow(
        /specularStrength/,
      );
      expect(() => unlitMaterial({ emissionIntensity: value })).toThrow(
        /emissionIntensity/,
      );
    },
  );

  it("rejects invalid normals, exponents, colors, and conventions", () => {
    expect(() => litMaterial({ normalStrength: 5 })).toThrow(/normalStrength/);
    expect(() => litMaterial({ shininess: 0 })).toThrow(/shininess/);
    expect(() => litMaterial({ specularColor: Infinity })).toThrow(
      /specularColor/,
    );
    expect(() =>
      litMaterial({ specularColor: { r: Infinity, g: 0, b: 0 } }),
    ).toThrow(/specularColor/);
    expect(() =>
      unlitMaterial({ emissionColor: new Float32Array([NaN, 0, 1]) }),
    ).toThrow(/emissionColor/);
    expect(() => litMaterial({ normalY: "invalid" as "up" })).toThrow(
      /normalY/,
    );
  });

  it("shares one definition and replaces only the sprite it is set on", () => {
    registerTexture("material-color", image());
    const material = unlitMaterial({ emissionIntensity: 0.2 });
    const a = new SpriteComponent({ texture: "material-color", material });
    const b = new SpriteComponent({ texture: "material-color", material });
    expect(a.material).toBe(material);
    const brighter = unlitMaterial({ emissionIntensity: 0.8 });
    a.setMaterial(brighter);
    expect(a.material).toBe(brighter);
    expect(b.material).toBe(material);
    a.setMaterial(undefined);
    expect(a.material).toBeUndefined();
    a.onDestroy();
    b.onDestroy();
    expect(textures[0]!.destroyed).toBe(false);
  });

  it("rejects a copy of a definition and keeps the current material", () => {
    registerTexture("material-color", image());
    const material = unlitMaterial({ emissionIntensity: 0.2 });
    const copy = { ...material, emissionIntensity: NaN };
    expect(
      () => new SpriteComponent({ texture: "material-color", material: copy }),
    ).toThrow(/litMaterial\(\) or unlitMaterial\(\)/);
    const sprite = new SpriteComponent({ texture: "material-color", material });
    expect(() => sprite.setMaterial(copy)).toThrow(
      /litMaterial\(\) or unlitMaterial\(\)/,
    );
    expect(sprite.material).toBe(material);
    sprite.onDestroy();
  });

  it("lights sprites without a material on the world layers of a surface scene", () => {
    registerTexture("material-color", image());
    const { scene, tree } = surfaceScene();
    tree.ensureLayer({ name: "hud", order: 1 }, { space: "screen" });
    const sprite = spawnEntityInScene(scene).add(
      new SpriteComponent({ texture: "material-color" }),
    );
    expect(sprite.material).toBeUndefined();
    expect(sprite.sprite.renderPipeId).toBe("yage-material");
    expect(sprite.inspectRender()).toMatchObject({
      material: litMaterial(),
      lighting: "surface",
    });
    sprite.setLayer("hud");
    expect(sprite.sprite.renderPipeId).toBe("sprite");
    expect(sprite.inspectRender()).not.toHaveProperty("material");
    sprite.setLayer("default");
    sprite.setMaterial(unlitMaterial());
    expect(sprite.sprite.renderPipeId).toBe("yage-material");
    expect(sprite.inspectRender()).toMatchObject({
      material: { kind: "unlit" },
      lighting: "none",
    });
  });

  it("draws sprites without a material through Pixi outside surface scenes", () => {
    registerTexture("material-color", image());
    const { scene } = createRendererTestContext();
    const sprite = spawnEntityInScene(scene).add(
      new SpriteComponent({ texture: "material-color" }),
    );
    expect(sprite.sprite.renderPipeId).toBe("sprite");
    scene.registerScoped(SpriteLightingKey, { kind: "composite" });
    const other = spawnEntityInScene(scene).add(
      new SpriteComponent({ texture: "material-color" }),
    );
    expect(other.sprite.renderPipeId).toBe("sprite");
  });

  it("validates map role, dimensions, and full-page layout before replacing the source", () => {
    const base = image();
    registerTexture("material-color", base);
    registerTexture("material-other", image(16, 16));
    const normal = dataTexture("normal.png");
    Assets.cache.set(dataTextureKey(normal.path), image());
    const sprite = new SpriteComponent({
      texture: "material-color",
      maps: { normal },
    });
    expect(() => sprite.setTexture("material-other", { normal })).toThrow(
      /32×32/,
    );
    expect(sprite.sprite.texture).toBe(base);
    expect(sprite.maps.normal).toBe(normal);
    expect(() =>
      resolveMaps([base], {
        normal: texture("normal.png") as unknown as DataTextureHandle,
      }),
    ).toThrow(/dataTexture/);
    sprite.setTexture("material-other");
    expect(sprite.maps).toEqual({});
    sprite.onDestroy();
  });

  it("installs an animation's maps before notifying frame listeners and releases only frame views", () => {
    const sheet = image(64, 32);
    registerTexture("material-sheet", sheet);
    Assets.cache.set(dataTextureKey("normal.png"), image(64, 32));
    const normal = dataTexture("normal.png");
    const source = { sheet: "material-sheet", frameWidth: 32, count: 2 };
    const { scene } = surfaceScene();
    const sprite = spawnEntityInScene(scene).add(
      new AnimatedSpriteComponent({ source }),
    );
    const oldFrames = [...sprite.animatedSprite.textures];
    sprite.gotoFrame(1);
    const seen: (DataTextureHandle | undefined)[] = [];
    sprite.onFrameChange(() => seen.push(sprite.maps.normal));
    sprite.setSource({ ...source, maps: { normal } });
    expect(sprite.frame).toBe(0);
    expect(sprite.isPlaying).toBe(false);
    expect(seen).toEqual([normal]);
    expect(sprite.inspectRender()).toMatchObject({
      maps: { normal: "normal.png" },
      material: { kind: "lit" },
      frameIndex: 0,
      frame: { x: 0, y: 0, width: 32, height: 32, rotation: 0 },
    });
    sprite.gotoFrame(1);
    expect(sprite.inspectRender()).toMatchObject({
      frameIndex: 1,
      frame: { x: 32 },
    });
    expect(oldFrames.every((frame) => (frame as Texture).destroyed)).toBe(true);
    expect(sheet.destroyed).toBe(false);
    sprite.onDestroy();
  });

  it("rejects incompatible backends before changing a live material", () => {
    registerTexture("material-color", image());
    const { scene } = createRendererTestContext();
    const sprite = new SpriteComponent({ texture: "material-color" });
    // The component binds its scene through the same entry used on attachment.
    const entity = spawnEntityInScene(scene);
    entity.add(sprite);
    expect(() => sprite.setMaterial(litMaterial())).toThrow(/surfaceLighting/);
    expect(sprite.material).toBeUndefined();
    scene.registerScoped(SpriteLightingKey, { kind: "composite" });
    expect(() => sprite.setMaterial(unlitMaterial())).toThrow(
      /surfaceLighting/,
    );
    expect(sprite.material).toBeUndefined();
    expect(sprite.sprite.renderPipeId).toBe("sprite");
  });

  it("rejects a screen-space layer before moving a lit sprite", () => {
    registerTexture("material-color", image());
    const { scene, tree } = surfaceScene();
    tree.ensureLayer({ name: "hud", order: 1 }, { space: "screen" });
    const sprite = spawnEntityInScene(scene).add(
      new SpriteComponent({
        texture: "material-color",
        material: litMaterial(),
      }),
    );
    const parent = sprite.sprite.parent;
    expect(() => sprite.setLayer("hud")).toThrow(/world-space layer/);
    expect(sprite.layerName).toBe("default");
    expect(sprite.sprite.parent).toBe(parent);
  });
});

describe("mapped animation sources", () => {
  it("rejects multiple atlas pages but never destroys borrowed atlas views", () => {
    const first = image();
    const second = image();
    Assets.cache.set(dataTextureKey("normal.png"), image());
    Assets.cache.set("material-atlas", {
      animations: { split: [first, second], single: [first] },
    });
    const maps = { normal: dataTexture("normal.png") };
    expect(() =>
      resolveSpriteSource({
        atlas: "material-atlas",
        animation: "split",
        maps,
      }),
    ).toThrow(/one image page/);
    const resolved = resolveSpriteSource({
      atlas: "material-atlas",
      animation: "single",
      maps,
    });
    resolved.release();
    expect(first.destroyed).toBe(false);
    expect(second.destroyed).toBe(false);
  });

  it("rejects cropped companion pages", () => {
    const base = image();
    const crop = new Texture({
      source: base.source,
      frame: new Rectangle(0, 0, 16, 16),
    });
    Assets.cache.set(dataTextureKey("normal.png"), crop);
    expect(() =>
      resolveMaps([base], { normal: dataTexture("normal.png") }),
    ).toThrow(/full 32×32 page/);
    crop.destroy(false);
  });

  it("retains controller frame views until both controller and sprite release them", () => {
    registerTexture("material-sheet", image(64, 32));
    const source = { sheet: "material-sheet", frameWidth: 32, count: 2 };
    const { scene } = createRendererTestContext();
    const entity = spawnEntityInScene(scene);
    const sprite = entity.add(new AnimatedSpriteComponent({ source }));
    const controller = entity.add(
      new AnimationController({ idle: { source, speed: 0.1 } }),
    );
    const frames = [...sprite.animatedSprite.textures] as Texture[];
    controller.onDestroy();
    expect(frames.every((frame) => !frame.destroyed)).toBe(true);
    sprite.onDestroy();
    expect(frames.every((frame) => frame.destroyed)).toBe(true);
    expect(textures[0]!.source.destroyed).toBe(false);
  });

  it("rejects a controller whose maps the scene cannot draw when it is added", () => {
    registerTexture("material-sheet", image(64, 32));
    Assets.cache.set(dataTextureKey("normal.png"), image(64, 32));
    const source = { sheet: "material-sheet", frameWidth: 32, count: 2 };
    const { scene } = createRendererTestContext();
    scene.registerScoped(SpriteLightingKey, { kind: "composite" });
    const entity = spawnEntityInScene(scene);
    const sprite = entity.add(new AnimatedSpriteComponent({ source }));
    const before = sprite.animatedSprite.textures;
    const controller = new AnimationController({
      idle: { source, speed: 0.1 },
      mapped: {
        source: { ...source, maps: { normal: dataTexture("normal.png") } },
        speed: 0.1,
      },
    });
    expect(() => entity.add(controller)).toThrow(/surfaceLighting/);
    expect(sprite.animatedSprite.textures).toBe(before);
    expect(() =>
      sprite.setSource({
        ...source,
        maps: { normal: dataTexture("normal.png") },
      }),
    ).toThrow(/surfaceLighting/);
    expect(sprite.animatedSprite.textures).toBe(before);
    controller.onDestroy();
    sprite.onDestroy();
  });
});

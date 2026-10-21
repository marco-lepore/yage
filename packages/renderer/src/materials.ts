import { Color } from "pixi.js";
import type {
  ColorValue,
  DataTextureHandle,
  TextureRef,
} from "./public-types.js";

/** Companion page images, using exactly the color texture's UV layout. */
export interface SpriteMaps {
  readonly normal?: DataTextureHandle;
  readonly specular?: DataTextureHandle;
  readonly emission?: TextureRef;
}

/** Self-lit color added before the sprite's ordinary tint and alpha. */
export interface UnlitMaterialOptions {
  emissionColor?: ColorValue;
  /** Finite 0..1. Default 0. Without a map, emits a uniform color. */
  emissionIntensity?: number;
}

/** Surface response to the scene's surfaceLighting backend. */
export interface LitMaterialOptions extends UnlitMaterialOptions {
  /** Finite 0..4. Default 1; 0 flattens the normal. */
  normalStrength?: number;
  /** Green-channel direction. Default "up" (OpenGL convention). */
  normalY?: "up" | "down";
  specularColor?: ColorValue;
  /** Finite 0..1. Default 0; the map multiplies this strength. */
  specularStrength?: number;
  /** Finite 1..256. Larger values narrow the highlight. Default 32. */
  shininess?: number;
}

/** Only the material factories produce a definition. */
declare const materialBrand: unique symbol;

interface EmissionDefinition {
  readonly [materialBrand]: true;
  readonly emissionColor: number;
  readonly emissionIntensity: number;
}

/**
 * Shading that ignores the scene's lights. Create with {@link unlitMaterial}.
 * Images and GPU resources are owned elsewhere.
 */
export interface UnlitMaterial extends EmissionDefinition {
  readonly kind: "unlit";
}

/**
 * Diffuse and Blinn–Phong specular response to a `surfaceLighting()` scene.
 * Create with {@link litMaterial}.
 */
export interface LitMaterial extends EmissionDefinition {
  readonly kind: "lit";
  readonly normalStrength: number;
  readonly normalY: "up" | "down";
  readonly specularColor: number;
  readonly specularStrength: number;
  readonly shininess: number;
}

export type SpriteMaterial = LitMaterial | UnlitMaterial;

/**
 * Every definition the factories returned. A spread copy keeps the brand's
 * type but not the identity, so the identity is what sprites check.
 */
const definitions = new WeakSet<SpriteMaterial>();

function register<T extends SpriteMaterial>(material: T): T {
  definitions.add(material);
  return material;
}

/** @internal Throw unless `material` is `undefined` or a factory's definition. */
export function assertMaterial(material: SpriteMaterial | undefined): void {
  if (material !== undefined && !definitions.has(material)) {
    throw new Error(
      "Sprite material: expected a definition returned by litMaterial() or unlitMaterial(), got another object.",
    );
  }
}

function range(
  value: number,
  low: number,
  high: number,
  context: string,
): number {
  if (!Number.isFinite(value) || value < low || value > high) {
    throw new Error(
      `${context}: expected a finite number in ${low}..${high}, got ${value}.`,
    );
  }
  return value;
}

function color(value: ColorValue, context: string): number {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffff) {
      throw new Error(
        `${context}: expected an RGB integer in 0..0xffffff, got ${value}.`,
      );
    }
    return value;
  }
  if (typeof value === "object") {
    const channels =
      value instanceof Color ? value.toArray() : Object.values(value);
    const invalid = channels.find(
      (channel) => typeof channel === "number" && !Number.isFinite(channel),
    );
    if (invalid !== undefined)
      throw new Error(
        `${context}: expected finite color channels, got ${invalid}.`,
      );
  }
  // Color accepts several formats. Its conversion also validates CSS strings.
  const result = new Color(value);
  if (!result.toArray().every(Number.isFinite)) {
    throw new Error(`${context}: expected a finite RGB color.`);
  }
  return result.toNumber();
}

function emission(
  options: UnlitMaterialOptions,
  context: string,
): Pick<UnlitMaterial, "emissionColor" | "emissionIntensity"> {
  return {
    emissionColor: color(
      options.emissionColor ?? 0xffffff,
      `${context}.emissionColor`,
    ),
    emissionIntensity: range(
      options.emissionIntensity ?? 0,
      0,
      1,
      `${context}.emissionIntensity`,
    ),
  };
}

/**
 * Create reusable settings for a sprite that ignores the scene's lights. In a
 * `surfaceLighting()` scene it opts the sprite out of lighting; elsewhere it
 * adds emission to ordinary drawing.
 */
export function unlitMaterial(
  options: UnlitMaterialOptions = {},
): UnlitMaterial {
  return register(
    Object.freeze({
      kind: "unlit",
      ...emission(options, "unlitMaterial"),
    }) as UnlitMaterial,
  );
}

/**
 * Create reusable lit settings for a sprite in a `surfaceLighting()` scene.
 * Sprites on a world layer of such a scene use `litMaterial()` when they set
 * no material of their own.
 */
export function litMaterial(options: LitMaterialOptions = {}): LitMaterial {
  const normalY = options.normalY ?? "up";
  if (normalY !== "up" && normalY !== "down") {
    throw new Error(
      `litMaterial.normalY: expected "up" or "down", got ${String(normalY)}.`,
    );
  }
  return register(
    Object.freeze({
      kind: "lit",
      ...emission(options, "litMaterial"),
      normalStrength: range(
        options.normalStrength ?? 1,
        0,
        4,
        "litMaterial.normalStrength",
      ),
      normalY,
      specularColor: color(
        options.specularColor ?? 0xffffff,
        "litMaterial.specularColor",
      ),
      specularStrength: range(
        options.specularStrength ?? 0,
        0,
        1,
        "litMaterial.specularStrength",
      ),
      shininess: range(
        options.shininess ?? 32,
        1,
        256,
        "litMaterial.shininess",
      ),
    }) as LitMaterial,
  );
}

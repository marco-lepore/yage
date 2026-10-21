import {
  ExtensionType,
  extensions,
  Matrix,
  State,
  Texture,
  RendererType,
} from "pixi.js";
import type {
  InstructionSet,
  RenderPipe,
  WebGLRenderer,
  WebGPURenderer,
} from "pixi.js";
import { MATERIAL_PIPE, materialBinding } from "./MaterialBinding.js";
import type { MaterialGpu, MaterialSprite } from "./MaterialBinding.js";
import { createMaterialGpu, MATERIAL_VERTEX_SIZE } from "./material-shader.js";

interface MaterialInstruction {
  renderPipeId: typeof MATERIAL_PIPE;
  canBundle: false;
  sprites: MaterialSprite[];
}

/** Material runs stay inside Pixi's existing blend, filter and mask boundaries. */
class MaterialPipe implements RenderPipe<MaterialSprite> {
  static get extension() {
    return {
      type: [ExtensionType.WebGLPipes, ExtensionType.WebGPUPipes],
      name: MATERIAL_PIPE,
    };
  }
  private readonly state = State.for2d();
  private readonly surface = new Matrix();

  // Registered only as a WebGL and WebGPU pipe.
  constructor(private readonly renderer: WebGLRenderer | WebGPURenderer) {}

  addRenderable(sprite: MaterialSprite, instructions: InstructionSet): void {
    this.renderer.renderPipes.batch.break(instructions);
    const previous =
      instructions.instructions[instructions.instructionSize - 1];
    if (previous?.renderPipeId === MATERIAL_PIPE) {
      (previous as MaterialInstruction).sprites.push(sprite);
    } else {
      const instruction: MaterialInstruction = {
        renderPipeId: MATERIAL_PIPE,
        canBundle: false,
        sprites: [sprite],
      };
      instructions.add(instruction);
    }
  }
  updateRenderable(): void {}
  validateRenderable(): boolean {
    return false;
  }

  execute(instruction: MaterialInstruction): void {
    const sprites = instruction.sprites;
    for (let start = 0; start < sprites.length; ) {
      const first = sprites[start]!;
      let end = start + 1;
      while (end < sprites.length && compatible(first, sprites[end]!)) end++;
      this.draw(sprites, start, end);
      start = end;
    }
  }

  private draw(sprites: MaterialSprite[], start: number, end: number): void {
    const first = sprites[start]!;
    const binding = first[materialBinding];
    // The binding routes a sprite here only while it has a material.
    const material = binding.material!;
    const gpu = (binding.gpu ??= createMaterialGpu(binding.lighting));
    reserve(gpu, end - start);
    let count = 0;
    for (let i = start; i < end; i++) {
      if (this.pack(sprites[i]!, gpu.vertices, count)) count++;
    }
    if (count === 0) return;
    const { uniforms, shader, geometry } = gpu;
    geometry
      .getBuffer("aPosition")
      .update(count * 4 * MATERIAL_VERTEX_SIZE * 4);
    uniforms.uParams.set(
      material.kind === "lit"
        ? [
            material.normalStrength,
            material.normalY === "up" ? -1 : 1,
            material.specularStrength,
            material.shininess,
          ]
        : [0, 1, 0, 1],
    );
    writeColor(
      uniforms.uEmission,
      material.emissionColor,
      material.emissionIntensity,
    );
    writeColor(
      uniforms.uSpecular,
      material.kind === "lit" ? material.specularColor : 0xffffff,
      0,
    );
    const maps = binding.maps;
    uniforms.uFlags.set([
      maps.normal ? 1 : 0,
      maps.specular ? 1 : 0,
      maps.emission
        ? maps.emission.source.alphaMode === "no-premultiply-alpha"
          ? 2
          : 1
        : 0,
      first.texture.source.alphaMode === "no-premultiply-alpha" ? 1 : 0,
    ]);
    for (const [role, image] of [
      ["Color", first.texture],
      ["Normal", maps.normal],
      ["Specular", maps.specular],
      ["Emission", maps.emission],
    ] as const) {
      const source = (image ?? Texture.WHITE).source;
      shader.resources[`u${role}Texture`] = source;
      shader.resources[`u${role}Sampler`] = source.style;
    }
    // GL programs share uniform values; WebGPU buffers belong to this binding.
    gpu.group.isStatic = this.renderer.type !== RendererType.WEBGL;
    let index = 0;
    let dirty = false;
    for (const vector of [
      uniforms.uParams,
      uniforms.uEmission,
      uniforms.uSpecular,
      uniforms.uFlags,
    ]) {
      for (const value of vector) {
        if (gpu.previousUniforms[index] !== value) {
          gpu.previousUniforms[index] = value;
          dirty = true;
        }
        index++;
      }
    }
    if (dirty) gpu.group.update();
    // The shader always emits premultiplied pixels, including NPM source images.
    const blend = first.groupBlendMode;
    this.state.blendMode =
      blend === "normal-npm"
        ? "normal"
        : blend === "add-npm"
          ? "add"
          : blend === "screen-npm"
            ? "screen"
            : blend;
    if (this.renderer.type === RendererType.WEBGL)
      shader.groups[100] = this.renderer.globalUniforms.bindGroup;
    else shader.groups[0] = this.renderer.globalUniforms.bindGroup;
    this.renderer.encoder.draw({
      geometry,
      shader,
      state: this.state,
      size: count * 6,
    });
  }

  private pack(
    sprite: MaterialSprite,
    data: Float32Array,
    index: number,
  ): boolean {
    if (!sprite.isRenderable) return false;
    const binding = sprite[materialBinding];
    const texture = sprite.texture;
    if (binding.maps.page && texture.source !== binding.maps.page)
      throw new Error(
        "Sprite maps: source changed outside its component. Use setTexture(), setSource(), or AnimationController.",
      );
    sprite.updateLocalTransform();
    const surface = this.surface.copyFrom(sprite.localTransform);
    let parent = sprite.parent;
    while (parent && parent !== binding.layer?.container) {
      parent.updateLocalTransform();
      surface.prepend(parent.localTransform);
      parent = parent.parent;
    }
    const determinant = surface.a * surface.d - surface.b * surface.c;
    if (determinant === 0) return false;
    const transform = sprite.groupTransform;
    const bounds = sprite.visualBounds;
    const uv = texture.uvs;
    const packed = sprite.groupColorAlpha;
    const round = this.renderer._roundPixels | sprite._roundPixels;
    const na = surface.d / determinant;
    const nb = -surface.c / determinant;
    const nc = -surface.b / determinant;
    const nd = surface.a / determinant;
    let offset = index * 4 * MATERIAL_VERTEX_SIZE;
    for (let vertex = 0; vertex < 4; vertex++) {
      const x = vertex === 0 || vertex === 3 ? bounds.minX : bounds.maxX;
      const y = vertex < 2 ? bounds.minY : bounds.maxY;
      data[offset++] = transform.a * x + transform.c * y + transform.tx;
      data[offset++] = transform.b * x + transform.d * y + transform.ty;
      data[offset++] =
        vertex === 0
          ? uv.x0
          : vertex === 1
            ? uv.x1
            : vertex === 2
              ? uv.x2
              : uv.x3;
      data[offset++] =
        vertex === 0
          ? uv.y0
          : vertex === 1
            ? uv.y1
            : vertex === 2
              ? uv.y2
              : uv.y3;
      data[offset++] = surface.a * x + surface.c * y + surface.tx;
      data[offset++] = surface.b * x + surface.d * y + surface.ty;
      data[offset++] = na;
      data[offset++] = nb;
      data[offset++] = nc;
      data[offset++] = nd;
      data[offset++] = (packed & 255) / 255;
      data[offset++] = ((packed >> 8) & 255) / 255;
      data[offset++] = ((packed >> 16) & 255) / 255;
      data[offset++] = ((packed >>> 24) & 255) / 255;
      data[offset++] = round;
    }
    return true;
  }
}

/** Values, rather than definition identity, allow independently authored presets to batch. */
function compatible(a: MaterialSprite, b: MaterialSprite): boolean {
  const left = a[materialBinding];
  const right = b[materialBinding];
  const lm = left.material!;
  const rm = right.material!;
  return (
    a.texture.source === b.texture.source &&
    a.groupBlendMode === b.groupBlendMode &&
    left.lighting === right.lighting &&
    left.maps.normal?.source === right.maps.normal?.source &&
    left.maps.specular?.source === right.maps.specular?.source &&
    left.maps.emission?.source === right.maps.emission?.source &&
    lm.kind === rm.kind &&
    lm.emissionColor === rm.emissionColor &&
    lm.emissionIntensity === rm.emissionIntensity &&
    (lm.kind !== "lit" ||
      rm.kind !== "lit" ||
      (lm.normalStrength === rm.normalStrength &&
        lm.normalY === rm.normalY &&
        lm.specularColor === rm.specularColor &&
        lm.specularStrength === rm.specularStrength &&
        lm.shininess === rm.shininess))
  );
}

function reserve(gpu: MaterialGpu, count: number): void {
  if (gpu.capacity >= count) return;
  while (gpu.capacity < count) gpu.capacity *= 2;
  gpu.vertices = new Float32Array(gpu.capacity * 4 * MATERIAL_VERTEX_SIZE);
  gpu.geometry.getBuffer("aPosition").data = gpu.vertices;
  const indices = new Uint32Array(gpu.capacity * 6);
  for (let i = 0; i < gpu.capacity; i++) {
    const v = i * 4;
    indices.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6);
  }
  gpu.geometry.indexBuffer.data = indices;
}

function writeColor(out: Float32Array, color: number, alpha: number): void {
  out.set([
    ((color >> 16) & 255) / 255,
    ((color >> 8) & 255) / 255,
    (color & 255) / 255,
    alpha,
  ]);
}

let installed = false;
export function installMaterialPipe(): void {
  if (installed) return;
  extensions.add(MaterialPipe);
  installed = true;
}

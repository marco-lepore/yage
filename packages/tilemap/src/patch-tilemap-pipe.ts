/**
 * Runtime patch for `@pixi/tilemap`'s `TilemapPipe.execute` that fixes two
 * upstream bugs around how the pipe reads the active world transform and
 * how it composes the tilemap's own transform on the GPU.
 *
 * **Bug 1 — stale `_activeUniforms.at(-1)` after pops.**
 * The vanilla pipe reads its `uWorldTransformMatrix` from
 * `renderer.globalUniforms._activeUniforms.at(-1)`. That array is the
 * per-frame push log — it grows on `globalUniforms.push()` but is NOT
 * trimmed on `globalUniforms.pop()`. So after a filter or sub-render-group
 * has pushed and popped its uniforms, the entry stays at the end of
 * `_activeUniforms` and the next tilemap draw picks up the stale matrix
 * instead of the currently-bound stack top. Symptom: a tilemap rendered
 * after a sibling filtered layer visibly drifts.
 *
 * **Bug 2 — `tilemap.worldTransform` double-applies the RG transform.**
 * When the tilemap is parented to a sub-render-group, Pixi populates
 * `Container.worldTransform` as `parentRG.worldTransform ×
 * relativeGroupTransform` — i.e. the full transform including the RG's
 * own. The pipe then multiplies that against `uWorldTransformMatrix`
 * (which is the SAME `parentRG.worldTransform`), applying the RG's
 * transform twice. Symptom: putting a tilemap inside a render group
 * (e.g. via `LayerDef.isRenderGroup`) makes the tilemap visibly "lag
 * double" the camera. Pixi's own `SpritePipe` / `GraphicsPipe` avoid this
 * by using `groupTransform` (transform relative to the nearest RG root)
 * instead of `worldTransform`.
 *
 * The patch swaps both reads:
 * - `_activeUniforms.at(-1)` → `globalUniforms.bindGroup.resources[0]`
 *   (the currently-bound uniform group, always matches the stack top).
 * - `tilemap.worldTransform` → `tilemap.groupTransform`.
 *
 * Applied once at module import; idempotent across re-imports.
 *
 * Targets `@pixi/tilemap@5.0.2` exactly — the package version is pinned
 * in `package.json` (no caret) so we don't double-patch a different shape.
 * If the dependency moves, re-verify the `execute` body still matches the
 * patched shape.
 */
// `TilemapPipe` is declared in `@pixi/tilemap`'s d.ts as
// `export declare class TilemapPipe implements RenderPipe<Tilemap>,
// InstructionPipe<TilemapInstruction>` — but Pixi v8 doesn't re-export
// `RenderPipe` / `InstructionPipe` at its package root, so TypeScript drops
// the class from the namespace at resolution time. The class is fully
// available at runtime, so we reach it through a `* as` import and a
// hand-rolled shape that exposes only what the patch touches.
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as tilemap from "@pixi/tilemap";

interface PipeClassShape {
  prototype: { execute: (instruction: { tilemap: unknown }) => void };
}

const TilemapPipeClass = (
  tilemap as unknown as { TilemapPipe: PipeClassShape }
).TilemapPipe;

const PATCHED_FLAG = Symbol.for("yage:tilemap-pipe-patched");

interface PatchableProto {
  [PATCHED_FLAG]?: boolean;
  execute: (instruction: { tilemap: unknown }) => void;
}

export function patchTilemapPipe(): void {
  const proto = TilemapPipeClass.prototype as unknown as PatchableProto;
  if (proto[PATCHED_FLAG]) return;
  proto[PATCHED_FLAG] = true;

  proto.execute = function patchedExecute(
    this: any,
    { tilemap: t }: { tilemap: any },
  ): void {
    if (!t.isRenderable) return;
    t.state.blendMode = t.groupBlendMode;
    const pipe_uniforms = this.adaptor.pipe_uniforms;
    const u_proj_trans = pipe_uniforms.uniforms.u_proj_trans;
    // Use the currently-bound uniform group (stack top) instead of the
    // last-pushed entry. See bug 1 above.
    const u_global =
      this.renderer.globalUniforms.bindGroup.resources[0].uniforms;
    let anim_frame: readonly number[] = this.tileAnim;
    const u_anim_frame: Float32Array = pipe_uniforms.uniforms.u_anim_frame;
    // Use groupTransform (relative to nearest RG root) instead of
    // worldTransform (which already includes parentRG.worldTransform).
    // See bug 2 above.
    u_global.uProjectionMatrix
      .copyTo(u_proj_trans)
      .append(u_global.uWorldTransformMatrix)
      .append(t.groupTransform);
    if (t.compositeParent) {
      anim_frame = t.parent.tileAnim ?? anim_frame;
    }
    u_anim_frame[0] = anim_frame[0]!;
    u_anim_frame[1] = anim_frame[1]!;
    pipe_uniforms.update();
    this.adaptor.execute(this, t);
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Side-effect import activates `declare module "@yagejs/core"` augmentation
// that types Scene's `readonly layers` field.
import "./scene-augmentation.js";

// Service keys & config
export { RendererKey } from "./types.js";
export type { RendererConfig, FitMode, RendererFitOptions } from "./types.js";
export type { CanvasRect, VirtualRect } from "./Fit.js";
export type {
  ColorValue,
  DisplayContainer,
  DisplaySprite,
  DisplayText,
  GradientFill,
  GraphicsContext,
  PointLike,
  RendererAsset,
  TextStyle,
  TextureHandle,
  TextureInput,
  TextureResource,
  TextureSliceOptions,
} from "./public-types.js";

// Plugin
export { RendererPlugin } from "./RendererPlugin.js";

// Components
export { SpriteComponent } from "./SpriteComponent.js";
export type { SpriteComponentOptions, SpriteData } from "./SpriteComponent.js";
export { GraphicsComponent } from "./GraphicsComponent.js";
export type {
  GraphicsComponentOptions,
  GraphicsData,
} from "./GraphicsComponent.js";
export { TextComponent } from "./TextComponent.js";
export type { TextComponentOptions, TextData } from "./TextComponent.js";
export { linearGradient, radialGradient } from "./gradient.js";
export type {
  GradientStop,
  GradientSpace,
  LinearGradientOptions,
  RadialGradientOptions,
} from "./gradient.js";
export { AnimatedSpriteComponent } from "./AnimatedSpriteComponent.js";
export type {
  AnimatedSpriteComponentOptions,
  AnimatedSpriteData,
} from "./AnimatedSpriteComponent.js";
export { AnimationController } from "./AnimationController.js";
export type {
  AnimationDef,
  AnimationControllerData,
} from "./AnimationController.js";

// Spritesheet utilities
export {
  sliceSheet,
  resolveFrames,
  isStripSource,
  isAtlasSource,
} from "./spritesheet.js";
export type {
  FrameSource,
  StripFrameSource,
  AtlasFrameSource,
} from "./spritesheet.js";

// Camera — entity-based system
export { CameraEntity } from "./CameraEntity.js";
export type { CameraEntityParams } from "./CameraEntity.js";
export { CameraComponent } from "./CameraComponent.js";
export type {
  CameraBounds,
  CameraFollowOptions,
  CameraShakeOptions,
  CameraBinding,
  CameraComponentOptions,
} from "./CameraComponent.js";
export { CameraFollow } from "./CameraFollow.js";
export { CameraShake } from "./CameraShake.js";
export { CameraBoundsComponent } from "./CameraBoundsComponent.js";
export { CameraZoom } from "./CameraZoom.js";
export { ScreenFollow } from "./ScreenFollow.js";
export type { ScreenFollowOptions, ScreenFollowTarget } from "./ScreenFollow.js";

// Display
export { DisplaySystem } from "./DisplaySystem.js";
export { RenderLayer, RenderLayerManager } from "./RenderLayer.js";
export type { CreateLayerOptions } from "./RenderLayer.js";

// Per-scene render tree
export type { LayerDef, LayerSpace } from "./LayerDef.js";
export type {
  EnsureLayerOptions,
  SceneRenderTree,
  SceneRenderTreeProvider,
} from "./SceneRenderTree.js";
export {
  SceneRenderTreeKey,
  SceneRenderTreeProviderKey,
} from "./SceneRenderTree.js";
export { SceneRenderTreeProviderImpl } from "./SceneRenderTreeProvider.js";

// Transitions
export * from "./transitions/index.js";

// Asset factories
export {
  renderAsset,
  resolveTextureInput,
  sliceTextureFrames,
  spritesheet,
  texture,
} from "./assets.js";

// Effects
export type {
  EffectHandle,
  EffectProcessHost,
} from "./effects/EffectHandle.js";
export type {
  Effect,
  EffectFactory,
  EffectScope,
  EffectTarget,
} from "./effects/Effect.js";
export { EffectStack } from "./effects/EffectStack.js";
export type {
  EffectStackSnapshot,
  EffectStackEntry,
} from "./effects/EffectStack.js";
export { defineEffect } from "./effects/defineEffect.js";
export type { EffectDefinition } from "./effects/defineEffect.js";
export { rawFilter } from "./effects/rawFilter.js";
export type { RawFilterOptions } from "./effects/rawFilter.js";
export { withFade } from "./effects/withFade.js";
export type { RendererSnapshotData } from "./effects/RendererSnapshotContributor.js";

// Masks
export type { MaskHandle, MaskSnapshot } from "./masks/MaskHandle.js";
export type { Mask, MaskFactory } from "./masks/MaskFactory.js";
export { attachMask, restoreMask } from "./masks/attachMask.js";
export { defineMask } from "./masks/defineMask.js";
export type { MaskDefinition } from "./masks/defineMask.js";
export { rectMask } from "./masks/rectMask.js";
export type { RectMaskOptions } from "./masks/rectMask.js";
export { spriteMask } from "./masks/spriteMask.js";
export { graphicsMask } from "./masks/graphicsMask.js";

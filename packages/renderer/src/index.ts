// Side-effect import activates `declare module "@yagejs/core"` augmentation
// that types Scene's `readonly layers` field.
import "./scene-augmentation.js";

// Service keys & config
export { RendererKey } from "./types.js";
export type { RendererConfig } from "./types.js";
export type {
  ColorValue,
  DisplayContainer,
  DisplaySprite,
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

// Display
export { DisplaySystem } from "./DisplaySystem.js";
export { RenderLayer, RenderLayerManager } from "./RenderLayer.js";
export type { CreateLayerOptions } from "./RenderLayer.js";

// Per-scene render tree
export type { LayerDef } from "./LayerDef.js";
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
export { fade } from "./transitions/fade.js";
export type { FadeOptions } from "./transitions/fade.js";
export { flash } from "./transitions/flash.js";
export type { FlashOptions } from "./transitions/flash.js";
export { crossFade } from "./transitions/crossFade.js";
export type { CrossFadeOptions } from "./transitions/crossFade.js";
export { getSceneContainer } from "./transitions/helpers.js";

// Asset factories
export {
  renderAsset,
  resolveTextureInput,
  sliceTextureFrames,
  spritesheet,
  texture,
} from "./assets.js";

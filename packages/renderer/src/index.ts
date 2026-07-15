// Side-effect import activates `declare module "@yagejs/core"` augmentation
// that types Scene's `readonly layers` field.
import "./scene-augmentation.js";
import "./internal/duplicateModuleGuard.js";

// Service keys & config
export { RendererKey } from "./types.js";
export type { RendererConfig, FitMode, RendererFitOptions } from "./types.js";
export type { CanvasRect, VirtualRect } from "./Fit.js";
export type {
  Application,
  ApplicationOptions,
  BitmapFontHandle,
  BitmapFontResource,
  BlendMode,
  ColorValue,
  DestroyOptions,
  DisplayAnimatedSprite,
  DisplayBitmapText,
  DisplayContainer,
  DisplaySplitBitmapText,
  DisplaySplitText,
  DisplaySprite,
  DisplayText,
  Filter,
  GradientFill,
  GraphicsContext,
  NineSliceSprite,
  Particle,
  ParticleContainer,
  PointLike,
  RendererAsset,
  TextStyle,
  TextureHandle,
  TextureInput,
  TextureRef,
  TextureResource,
  TextureSliceOptions,
  WebFontHandle,
  WebFontResource,
} from "./public-types.js";

// Plugin
export { RendererPlugin } from "./RendererPlugin.js";

// Inspector render facet — the renderer owns this type and publishes it into the
// Inspector snapshot via RenderFacetContributor (which also augments core's
// `InspectorFacets` so `snapshot.entities[].facets?.render` is typed). Exporting
// the contributor activates that `declare module` augmentation for consumers.
export { RenderFacetContributor } from "./RenderFacetContributor.js";
export type {
  RenderFacetSnapshot,
  RenderInspectable,
} from "./internal/renderFacet.js";

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
export { SplitTextComponent } from "./SplitTextComponent.js";
export type {
  SplitTextComponentOptions,
  SplitTextData,
  SegmentAnchor,
  SplitTextRenderFacet,
  SplitTextRenderFacetExtras,
  SplitTextSegments,
  SplitListener,
} from "./SplitTextComponent.js";
export { SortGroupComponent, resolveRenderParent } from "./SortGroupComponent.js";
export type {
  SortGroupComponentOptions,
  SortGroupData,
  LayerRenderable,
} from "./SortGroupComponent.js";
/** @internal - shared Text/BitmapText constructor logic for @yagejs/ui, not for public consumption. */
export {
  buildTextOptions,
  resolveTextStyle,
  getDefaultTextStyle,
  setDefaultTextStyle,
} from "./internal/textConstruction.js";
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
export { LayeredAnimationController } from "./LayeredAnimationController.js";
export type { LayeredAnimationControllerOptions } from "./LayeredAnimationController.js";

// Spritesheet utilities
export {
  sliceSheet,
  sliceGrid,
  resolveFrames,
  isSheetSource,
  isAtlasSource,
} from "./spritesheet.js";
export type {
  FrameSource,
  SheetFrameSource,
  AtlasFrameSource,
} from "./spritesheet.js";

// Camera — entity-based system
export { CameraEntity } from "./CameraEntity.js";
export type { CameraEntityParams, CameraFitToRect } from "./CameraEntity.js";
export { CameraComponent } from "./CameraComponent.js";
export type {
  CameraBounds,
  CameraFollowOptions,
  CameraShakeOptions,
  CameraBinding,
  CameraComponentOptions,
  CameraComponentData,
} from "./CameraComponent.js";
export { CameraFollow } from "./CameraFollow.js";
export type { CameraFollowData } from "./CameraFollow.js";
export { CameraShake } from "./CameraShake.js";
export type { CameraShakeData } from "./CameraShake.js";
export { CameraBoundsComponent } from "./CameraBoundsComponent.js";
export type { CameraBoundsComponentData } from "./CameraBoundsComponent.js";
export { CameraZoom } from "./CameraZoom.js";
export type { CameraZoomData } from "./CameraZoom.js";
export { ScreenFollow } from "./ScreenFollow.js";
export type {
  ScreenFollowOptions,
  ScreenFollowTarget,
  ScreenFollowData,
} from "./ScreenFollow.js";

// Display
export { DisplaySystem } from "./DisplaySystem.js";
export { RenderLayer, RenderLayerManager } from "./RenderLayer.js";
export type { CreateLayerOptions } from "./RenderLayer.js";

// Per-scene render tree
export type { LayerDef, LayerSortFn, LayerSpace } from "./LayerDef.js";
export { ySort, ySortBy } from "./ySort.js";
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
  bitmapFont,
  createNineSlice,
  installBitmapFont,
  measureWrappedText,
  registerTexture,
  renderAsset,
  resolveTextureInput,
  sliceTextureFrames,
  spritesheet,
  texture,
  uninstallBitmapFont,
  unregisterTexture,
  webFont,
} from "./assets.js";
export type {
  BitmapFontVariant,
  InstallBitmapFontOptions,
  MeasuredText,
  MeasureTextOptions,
  NineSliceOptions,
  WebFontBakeOptions,
  WebFontOptions,
} from "./assets.js";

// Effects
export type { EffectHandle } from "./effects/EffectHandle.js";
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
export { EffectsHost } from "./effects/EffectsHost.js";
export { defineEffect } from "./effects/defineEffect.js";
export type { EffectDefinition } from "./effects/defineEffect.js";
export { rawFilter } from "./effects/rawFilter.js";
export type { RawFilterOptions } from "./effects/rawFilter.js";
export type { RendererSnapshotData } from "./effects/RendererSnapshotContributor.js";

// Offscreen buffers
export type {
  RenderTargetHandle,
  RenderTargetOptions,
} from "./RenderTarget.js";

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

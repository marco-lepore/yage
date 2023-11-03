import {
  AnimatedSprite,
  Assets,
  Spritesheet,
  Texture,
  Transform,
} from 'pixi.js'
import { GameObject } from '../../GameObject'
import { GraphicComponent } from '../GraphicComponent'

export class AnimatedGraphicComponent<
  Parent extends GameObject = GameObject,
> extends GraphicComponent<Parent, AnimatedSprite> {
  name = 'AnimatedGraphicComponent'
  baseSpeed: number
  anim: Record<string, Texture[]>
  currentAnimation: string | null = null
  get currentFrame() {
    return this.graphic.currentFrame
  }
  get isPlaying() {
    return this.graphic.playing
  }

  get animationState() {
    const { currentAnimation, currentFrame, isPlaying } = this
    return {
      currentAnimation,
      currentFrame,
      isPlaying,
    }
  }

  constructor(
    parent: Parent,
    options: {
      spritesheet: Spritesheet | string
      linkedTransform?: Transform
      baseSpeed?: number
    },
  ) {
    const { spritesheet, linkedTransform, baseSpeed } = options
    const animatedSprite = new AnimatedSprite([Texture.EMPTY])
    super(parent, { graphic: animatedSprite, linkedTransform })
    this.baseSpeed = baseSpeed ?? 0.1
    this.graphic.animationSpeed = this.baseSpeed
    this.graphic.updateAnchor = true
    if (typeof spritesheet === 'string') {
      const asset: Spritesheet = Assets.get(spritesheet)
      if (!asset) {
        throw new Error('Spritesheet ' + spritesheet + ' not found')
      }
      this.anim = this.makeAnimations(asset)
    } else {
      this.anim = this.makeAnimations(spritesheet)
    }
  }

  makeAnimations(spritesheet: Spritesheet) {
    const anim: Record<string, Texture[]> = {
      ...spritesheet.animations,
    }
    Object.entries(spritesheet.textures).forEach(([key, texture]) => {
      anim[key] = [texture]
    })
    return anim
  }

  play(
    animationName: string,
    options?: {
      restartOnPlay?: boolean
      speed?: number
      loop?: boolean
      onComplete?: () => void
      onFrameChange?: (currentFrame: number) => void
      onLoop?: () => void
    },
  ) {
    if (!this.anim[animationName]) {
      throw new Error('Animation name ' + animationName + ' not found')
    }
    if (this.currentAnimation === animationName && !options.restartOnPlay) {
      return
    }
    this.currentAnimation = animationName
    this.graphic.textures = this.anim[animationName]
    this.graphic.loop = options?.loop ?? false
    this.graphic.play()
    this.graphic.animationSpeed = options?.speed ?? this.baseSpeed
    this.graphic.onComplete = options?.onComplete
    this.graphic.onLoop = options?.onLoop
    this.graphic.onFrameChange = options?.onFrameChange
  }

  stop() {
    this.graphic.stop()
    this.currentAnimation = null
  }
}

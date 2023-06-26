import {
  AnimatedSprite,
  Assets,
  Container,
  Graphics,
  Sprite,
  Spritesheet,
  Texture,
  Transform,
} from 'pixi.js'
import { GameObject } from '../../GameObject'
import { GraphicComponent } from '../GraphicComponent'

export class AnimatedGraphicComponent<
  Parent extends GameObject = GameObject,
> extends GraphicComponent<Parent> {
  name = 'AnimatedGraphicComponent'
  container = new Container()
  sprite: AnimatedSprite
  baseSpeed: number
  anim: Record<string, Texture[]>
  currentAnimation: string | null = null
  constructor(
    parent: Parent,
    spritesheet: Spritesheet | string,
    linkedTransform?: Transform,
    baseSpeed?: number,
  ) {
    const animatedSprite = new AnimatedSprite([Texture.EMPTY])
    super(parent, { graphic: animatedSprite, linkedTransform })
    this.sprite = animatedSprite
    this.baseSpeed = baseSpeed ?? 0.1
    this.sprite.animationSpeed = this.baseSpeed
    this.sprite.updateAnchor = true
    if (typeof spritesheet === 'string') {
      const asset: Spritesheet = Assets.get(spritesheet)
      if (!asset) {
        throw new Error('Spritesheet ' + spritesheet + ' not found')
      }
      this.anim = this.makeAnimations(asset)
    } else {
      this.anim = this.makeAnimations(spritesheet)
    }
    this.container.addChild(this.sprite)
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

  play(animationName: string, speed?: number) {
    if (!this.anim[animationName]) {
      throw Error('Animation name ' + animationName + ' not found')
    }
    if (this.currentAnimation === animationName) {
      return
    }
    this.currentAnimation = animationName
    this.sprite.textures = this.anim[animationName]
    this.sprite.loop = true
    this.sprite.play()
    this.sprite.animationSpeed = speed ?? this.baseSpeed
  }

  stop() {
    this.sprite.stop()
  }
}

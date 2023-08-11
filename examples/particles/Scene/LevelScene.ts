import { ColliderDesc, RigidBodyDesc, Vector2 } from '@dimforge/rapier2d'
import {
  GameObject,
  GraphicComponent,
  ParticlesEmitterComponent,
  RapierBodyComponent,
  Scene,
  getPlayAreaBounds,
  pu,
} from '../../../src'
import config from './emitterConfig.json'
import collisionConfig from './collisionEmitterConfig.json'
import { Graphics, Texture } from 'pixi.js'
import { upgradeConfig } from '@pixi/particle-emitter'

class Ball extends GameObject {
  name = 'Ball'
  collisionEmitter: ParticlesEmitterComponent
  constructor(parent: Scene<any, any>, x: number, y: number) {
    super(parent)
    const radius = 40
    const [px, py, pr] = pu(x, y, radius)
    const rigidBody = RigidBodyDesc.dynamic().setTranslation(px, py)
    const collider = ColliderDesc.ball(pr).setRestitution(1)
    const phys = this.addComponent(RapierBodyComponent, rigidBody, collider)

    const particle = Texture.from('particle')
    const spark = Texture.from('sparks')

    const emitter = this.addComponent(ParticlesEmitterComponent, {
      config: upgradeConfig(config, [particle]),
      linkedTransform: phys.transform,
      autoEmit: true,
    })

    this.collisionEmitter = this.addComponent(ParticlesEmitterComponent, {
      config: upgradeConfig(collisionConfig, [spark]),
    })

    const graphic = new Graphics()
    graphic.beginFill(0xffffff)
    graphic.drawCircle(0, 0, radius)
    graphic.endFill()
    this.addComponent(GraphicComponent, {
      graphic,
      linkedTransform: phys.transform,
    })

    phys.rigidBody.applyImpulse(new Vector2(1500, 930), true)
  }
}

class Wall extends GameObject {
  constructor(
    parent: Scene<any, any>,
    x: number,
    y: number,
    w: number,
    h: number,
  ) {
    super(parent)
    const [px, py, pw, ph] = pu(x, y, w, h)
    const rigidBody = RigidBodyDesc.fixed()
    const collider = ColliderDesc.cuboid(pw / 2, ph / 2)
      .setTranslation(px, py)
      .setRestitution(1)
    const phys = this.addComponent(RapierBodyComponent, rigidBody, collider)

    const graphic = new Graphics()
    graphic.beginFill(0xffffff)
    graphic.drawRect(x - w / 2, y - h / 2, w, h)
    graphic.endFill()
    this.addComponent(GraphicComponent, {
      graphic,
      linkedTransform: phys.transform,
    })
  }
}

export class LevelScene extends Scene<any, any> {
  assetsBundleId = 'scene1'
  assetsBundle = {
    particle: '/assets/examples/particles/particle.png',
    sparks: '/assets/examples/particles/sparks.png',
  }
  onLoad() {
    super.onLoad()
    this.rapier.pixelToMeterRatio = 10
    this.rapier.world.gravity = new Vector2(0, 0)
    const { width, height } = getPlayAreaBounds()
    const ball = this.instantiateGameObject(Ball, width / 2, height / 2)

    this.instantiateGameObject(Wall, 0, height / 2, 30, height)
    this.instantiateGameObject(Wall, width, height / 2, 30, height)
    this.instantiateGameObject(Wall, width / 2, 0, width, 30)
    this.instantiateGameObject(Wall, width / 2, height, width, 30)
  }
}

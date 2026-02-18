import {
  ActiveEvents,
  ColliderDesc,
  ConvexPolygon,
  RigidBodyDesc,
  Vector2,
} from '@dimforge/rapier2d'
import {
  AnimatedGraphicComponent,
  GameObject,
  GraphicComponent,
  RapierBodyComponent,
  Scene,
  getPlayAreaBounds,
  pu,
} from '../../../src'
import { Graphics } from 'pixi.js'
import cutPhysicsData from './cut-physics.json'

const ANIMATIONS_PHYSICS_DATA: Record<string, { shape: number[] }[][]> = {
  cut: [
    cutPhysicsData['cut-3'],
    cutPhysicsData['cut-4'],
    cutPhysicsData['cut-5'],
    cutPhysicsData['cut-6'],
  ],
}

class SwordAnimated extends AnimatedGraphicComponent {
  baseSpeed = 0.2
}

class SwordPhysics extends RapierBodyComponent<ColliderDesc, Sword> {
  constructor(parent: Sword, x: number, y: number) {
    const [px, py] = pu(x, y)
    const rigidBodyDesc = RigidBodyDesc.fixed().setTranslation(px, py)
    const colliderDesc = ColliderDesc.ball(1)
      .setSensor(true)
      .setActiveEvents(ActiveEvents.COLLISION_EVENTS)
    super(parent, rigidBodyDesc, colliderDesc)
  }

  randomizeTransform() {
    this.rigidBody.setTranslation(
      {
        x: Math.random() * 60 + 2,
        y: this.rigidBody.translation().y,
      },
      false,
    )
    this.rigidBody.setRotation(Math.random() * 2 * Math.PI, false)
    this.forceUpdateTransform()
  }

  onFixedTick(elapsedMS: number): void {
    super.onFixedTick(elapsedMS)
    const {
      currentAnimation,
      currentFrame,
      isPlaying,
      graphic: { scale },
    } = this.parent.animatedSprite
    if (!currentAnimation || !isPlaying) {
      this.rigidBody.setEnabled(false)

      return
    }
    const framePhysicsData =
      ANIMATIONS_PHYSICS_DATA[currentAnimation]?.[currentFrame]
    if (!framePhysicsData) {
      return // maybe throw an error here
    }
    this.rigidBody.setEnabled(true)
    framePhysicsData.forEach(({ shape }) => {
      const array = Float32Array.from(pu(...shape).map((v) => scale.x * v))
      const s = new ConvexPolygon(array, true)
      this.colliders.setShape(s)
    })
  }
}

class Sword extends GameObject {
  animatedSprite: SwordAnimated
  constructor(parent: AnimationScene, x: number, y: number) {
    super(parent)

    const phys = this.addComponent(SwordPhysics, x, y)
    const animatedSprite = this.addComponent(SwordAnimated, {
      spritesheet: 'cut',
      linkedTransform: phys.transform,
    })

    setInterval(() => {
      phys.randomizeTransform()
      animatedSprite.graphic.scale.set(Math.random() * 1.5 + 0.5)
      animatedSprite.play('cut', {
        restartOnPlay: true,
        loop: false,
        onComplete: () => (animatedSprite.enabled = false),
      })
      animatedSprite.enabled = true
    }, 2000)
    this.animatedSprite = animatedSprite
  }

  onFixedTick(elapsedMS: number): void {
    super.onFixedTick(elapsedMS)
  }
}

class Ball<ParentScene extends AnimationScene> extends GameObject<ParentScene> {
  radius = 2
  constructor(
    parent: ParentScene,
    x: number,
    y: number,
    vx: number,
    vy: number,
  ) {
    super(parent)
    const [px, py, pr] = pu(x, y, this.radius)
    const rigidBody = RigidBodyDesc.dynamic().setTranslation(px, py)

    const collider = ColliderDesc.ball(pr)
      .setRestitution(1)
      .setActiveEvents(ActiveEvents.COLLISION_EVENTS)
    const phys = this.addComponent(RapierBodyComponent, rigidBody, collider)

    const graphic = new Graphics()
    graphic.beginFill(0xFFFFFF)
    graphic.drawCircle(0, 0, this.radius)
    graphic.endFill()
    this.addComponent(GraphicComponent, {
      graphic,
      linkedTransform: phys.transform,
    })

    phys.rigidBody.setLinvel({ x: vx, y: vy }, false)

    phys.onCollision((event) => {
      console.log(event)
      if (event.otherComponent?.parent instanceof Sword) {
        this.queueDestroy()
      }
    })
  }
}

class Wall extends GameObject {
  constructor(
    parent: AnimationScene,
    x: number,
    y: number,
    w: number,
    h: number,
    isSensor?: boolean,
  ) {
    super(parent)
    const [px, py, pw, ph] = pu(x, y, w, h)
    const rigidBody = RigidBodyDesc.fixed()
    const collider = ColliderDesc.cuboid(pw / 2, ph / 2)
      .setTranslation(px, py)
      .setRestitution(1)
      .setSensor(!!isSensor)
      .setActiveEvents(ActiveEvents.COLLISION_EVENTS)
    const phys = this.addComponent(RapierBodyComponent, rigidBody, collider)

    const graphic = new Graphics()
    graphic.beginFill(0xFFFFFF)
    graphic.drawRect(x - w / 2, y - h / 2, w, h)
    graphic.endFill()
    if (isSensor) {
      graphic.visible = false
    }
    this.addComponent(GraphicComponent, {
      graphic,
      linkedTransform: phys.transform,
    })

    phys.onCollision((event) => {
      if (event.otherComponent?.parent instanceof Ball) {
        event.otherComponent.parent.queueDestroy()
      }
    })
  }
}

export class AnimationScene extends Scene<void> {
  assetsBundle = {
    cut: '/assets/examples/animated-sprite/cut.json',
  }
  onLoad() {
    super.onLoad()
    this.rapier.pixelToMeterRatio = 10
    this.rapier.world.gravity = new Vector2(0, 0)
    const { width, height } = getPlayAreaBounds()

    this.instantiateGameObject(Wall, 0, height / 2, 30, height, true)
    this.instantiateGameObject(Wall, width, height / 2, 30, height, true)
    this.instantiateGameObject(Wall, width / 2, 0, width, 30)
    this.instantiateGameObject(Wall, width / 2, height, width, 30)
    this.instantiateGameObject(Sword, width / 2, height / 2)

    setInterval(
      () =>
        this.instantiateGameObject(
          Ball,
          width - 50,
          height / 2 + Math.random() * 80 - 40,
          -15,
          0,
        ),
      50,
    )
  }
}

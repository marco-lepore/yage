import { Component } from '../BaseComponent'
import { GameObject } from '../../GameObject'
import { Transform } from 'pixi.js'
import {
  Collider,
  ColliderDesc,
  RigidBody,
  RigidBodyDesc,
  Vector,
} from '@dimforge/rapier2d'

type CollisionEvent = {
  otherComponent?: RapierBodyComponent
  otherCollider: Collider
  collider: Collider
  started: boolean
}

type CollidersDescFormat =
  | ColliderDesc[]
  | Record<string | number, ColliderDesc>
  | ColliderDesc

type CollidersFormat<CDF> = CDF extends ColliderDesc[]
  ? Collider[]
  : CDF extends Record<string | number, ColliderDesc>
  ? { [Key in keyof CDF]: Collider }
  : CDF extends ColliderDesc
  ? Collider
  : never

export class RapierBodyComponent<
  Parent extends GameObject = GameObject,
  CDF extends CollidersDescFormat = CollidersDescFormat,
> extends Component<Parent> {
  name = 'RapierBodyComponent'
  bodyDesc: RigidBodyDesc
  collidersDesc: CDF
  rigidBody!: RigidBody
  handle = -1
  colliders!: CollidersFormat<CDF>
  transform = new Transform()
  prevTranslation: Vector

  constructor(parent: Parent, bodyDesc: RigidBodyDesc, collidersDesc: CDF) {
    super(parent)
    this.bodyDesc = bodyDesc

    this.collidersDesc = collidersDesc
    this.addToWorld()
    this.prevTranslation = this.rigidBody.translation()
    this.updateTransform()
    RapierBodyComponent.bodyComponentMap.set(this.rigidBody.handle, this)
    this.forEachCollider((collider) => {
      RapierBodyComponent.colliderComponentMap.set(collider.handle, this)
    })
  }

  onAdded(): void {
    super.onAdded()
  }

  destroy(): void {
    if (this.rigidBody) {
      RapierBodyComponent.bodyComponentMap.delete(this.rigidBody.handle)
      this.forEachCollider((collider) => {
        RapierBodyComponent.colliderComponentMap.delete(collider.handle)
      })
      this.removeFromWorld()
      super.destroy()
    }
  }

  onRemoved(): void {
    super.onRemoved()
    if (this.rigidBody) {
      RapierBodyComponent.bodyComponentMap.delete(this.rigidBody.handle)
      this.forEachCollider((collider) => {
        RapierBodyComponent.colliderComponentMap.delete(collider.handle)
      })
      this.removeFromWorld()
    }
  }

  forEachCollider(predicate: (collider: Collider) => void) {
    if (Array.isArray(this.colliders)) {
      return this.colliders.forEach(predicate)
    } else if (this.colliders instanceof Collider) {
      return predicate(this.colliders)
    }
    return Object.values(this.colliders).forEach(predicate)
  }

  collidersDescToColliders: (
    colliders: CDF,
    rigidBody: RigidBody,
  ) => CollidersFormat<CDF> = (colliders) => {
    const world = this.parent.scene.rapier.world
    if (Array.isArray(this.collidersDesc)) {
      return this.collidersDesc.map((colliderDesc) =>
        world.createCollider(colliderDesc, this.rigidBody),
      )
    } else if (this.collidersDesc instanceof ColliderDesc) {
      return world.createCollider(this.collidersDesc, this.rigidBody)
    }

    const entries = Object.entries(colliders).map(([key, colliderDesc]) => [
      key,
      world.createCollider(colliderDesc, this.rigidBody),
    ])
    return Object.fromEntries(entries)
  }

  addToWorld() {
    const world = this.parent.scene.rapier.world

    this.rigidBody = world.createRigidBody(this.bodyDesc)
    this.colliders = this.collidersDescToColliders(
      this.collidersDesc,
      this.rigidBody,
    )
  }

  handleCollision = (
    thisCollider: Collider,
    otherCollider: Collider,
    started: boolean,
  ) => {
    const otherComponent = RapierBodyComponent.colliderComponentMap.get(
      otherCollider.handle,
    )
    this.collisionEventHandlers.forEach((handler) =>
      handler({
        otherCollider: otherCollider,
        otherComponent: otherComponent,
        collider: thisCollider,
        started,
      }),
    )
  }

  collisionEventHandlers: ((ev: CollisionEvent) => void)[] = []
  onCollision(handler: (ev: CollisionEvent) => void) {
    this.collisionEventHandlers.push(handler)
  }

  removeFromWorld() {
    if (this.rigidBody) {
      this.parent.scene.rapier.world.removeRigidBody(this.rigidBody)
      this.rigidBody = null
    }
  }

  onBeforeTick(dt: number): void {
    super.onBeforeTick(dt)

    this.updateTransform()
  }

  onBeforeFixedTick(dt: number): void {
    this.prevTranslation = this.rigidBody.translation()
  }

  updateTransform() {
    const transform = this.transform
    const { pixelToMeterRatio } = this.parent.scene.rapier
    const body = this.rigidBody

    const { prevSimulationTime, simulationTime, gameTimeMS, fixedStep } =
      this.parent.scene.rapier

    const fullTimestep =
      simulationTime - prevSimulationTime > 0
        ? simulationTime - prevSimulationTime
        : fixedStep
    const factor = (gameTimeMS - prevSimulationTime) / fullTimestep

    if (body) {
      const { x, y } = body.translation()
      const { x: prevX, y: prevY } = this.prevTranslation ?? body.translation()
      const ix = prevX + (x - prevX) * factor
      const iy = prevY + (y - prevY) * factor
      transform.position.set(ix * pixelToMeterRatio, iy * pixelToMeterRatio)
      transform.rotation = body.rotation()
    }
  }

  get enabled() {
    return super.enabled
  }

  set enabled(v: boolean) {
    super.enabled = v
    this.rigidBody?.setEnabled(v)
  }

  static bodyComponentMap = new Map<number, RapierBodyComponent<any, any>>()
  static colliderComponentMap = new Map<number, RapierBodyComponent<any, any>>()
}

/* import { Component } from '../BaseComponent'
import { Body, Composite, Constraint, Events, IEventCollision } from 'matter-js'
import { GameObject } from '../../GameObject'
import { Transform } from 'pixi.js'

export class PhysicsComponent<
  Parent extends GameObject = GameObject,
> extends Component<Parent> {
  name = 'PhysicsComponent'
  body: Body = Body.create({ isStatic: true })
  transform = new Transform()

  constructor(body?: Body) {
    super()
    if (body) {
      this.body = body
    }
  }

  onAdded(): void {
    super.onAdded()
    this.addToWorld(this.body)
    this.trackCollisions()
    PhysicsComponent.bodyComponentMap.set(this.body, this)
  }

  destroy(): void {
    this.removeFromWorld(this.body)
    this.untrackCollisions()
    PhysicsComponent.bodyComponentMap.delete(this.body)
    super.destroy()
  }

  onRemoved(): void {
    super.onRemoved()
    this.removeFromWorld(this.body)
    this.untrackCollisions()
    PhysicsComponent.bodyComponentMap.delete(this.body)
  }

  addToWorld(
    object:
      | Body
      | Composite
      | Constraint
      | Array<Body | Composite | Constraint>,
  ) {
    if (this.parent.scene.physEngine.enabled) {
      Composite.add(this.parent.scene.physEngine.world, object)
    }
  }

  trackCollisions() {
    Events.on(
      this.parent.scene.physEngine,
      'collisionStart',
      this.onCollisionStartEvent,
    )
    Events.on(
      this.parent.scene.physEngine,
      'collisionActive',
      this.onCollisionActiveEvent,
    )
    Events.on(
      this.parent.scene.physEngine,
      'collisionEnd',
      this.onCollisionEndEvent,
    )
  }

  untrackCollisions() {
    Events.off(
      this.parent.scene.physEngine,
      'collisionStart',
      this.onCollisionStartEvent,
    )
    Events.off(
      this.parent.scene.physEngine,
      'collisionActive',
      this.onCollisionActiveEvent,
    )
    Events.off(
      this.parent.scene.physEngine,
      'collisionEnd',
      this.onCollisionEndEvent,
    )
  }

  private onCollisionStartEvent = (ev: IEventCollision<any>) => {
    ev.pairs.forEach((pair) => {
      if (pair.bodyA === this.body) {
        const component = PhysicsComponent.bodyComponentMap.get(pair.bodyB)
        if (component) {
          this.onCollisionStart(component)
        }
      } else if (pair.bodyB === this.body) {
        const component = PhysicsComponent.bodyComponentMap.get(pair.bodyA)
        if (component) {
          this.onCollisionStart(component)
        }
      }
    })
  }

  onCollisionStart(other: PhysicsComponent) {}

  private onCollisionActiveEvent = (ev: IEventCollision<any>) => {
    ev.pairs.forEach((pair) => {
      if (pair.bodyA === this.body) {
        const component = PhysicsComponent.bodyComponentMap.get(pair.bodyB)
        if (component) {
          this.onCollisionActive(component)
        }
      } else if (pair.bodyB === this.body) {
        const component = PhysicsComponent.bodyComponentMap.get(pair.bodyA)
        if (component) {
          this.onCollisionActive(component)
        }
      }
    })
  }

  onCollisionActive(other: PhysicsComponent) {}

  private onCollisionEndEvent = (ev: IEventCollision<any>) => {
    ev.pairs.forEach((pair) => {
      if (pair.bodyA === this.body) {
        const component = PhysicsComponent.bodyComponentMap.get(pair.bodyB)
        if (component) {
          this.onCollisionEnd(component)
        }
      } else if (pair.bodyB === this.body) {
        const component = PhysicsComponent.bodyComponentMap.get(pair.bodyA)
        if (component) {
          this.onCollisionEnd(component)
        }
      }
    })
  }

  onCollisionEnd(other: PhysicsComponent) {}

  removeFromWorld(object: Body | Composite | Constraint) {
    if (this.parent.scene.physEngine.enabled) {
      Composite.remove(this.parent.scene.physEngine.world, object)
    }
  }

  onTick(dt: number): void {
    super.onTick(dt)

    this.updateTransform()
  }

  updateTransform() {
    if (this.isEnabled()) {
      const transform = this.transform

      const body = this.body
      if (body) {
        transform.position.set(body.position.x, body.position.y)
        transform.rotation = body.angle
      }
    }
  }

  get enabled() {
    return super.enabled
  }

  set enabled(v: boolean) {
    super.enabled = v
    if (v) {
      this.addToWorld(this.body)
    } else {
      this.removeFromWorld(this.body)
    }
  }

  static bodyComponentMap = new WeakMap<Body, PhysicsComponent>()
}
 */

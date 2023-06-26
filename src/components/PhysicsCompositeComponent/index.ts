/* import { Component } from '../BaseComponent'
import { Body, Composite, Constraint } from 'matter-js'
import { GameObject } from '../../GameObject'
import { Transform } from 'pixi.js'

export class PhysicsCompositeComponent<
  Parent extends GameObject = GameObject,
> extends Component<Parent> {
  name = 'PhysicsCompositeComponent'
  composite: Composite = Composite.create()
  transform = new Transform()

  constructor(composite?: Composite) {
    super()
    if (composite) {
      this.composite = composite
    }
  }

  onAdded(): void {
    super.onAdded()
    this.addToWorld(this.composite)
  }

  destroy(): void {
    this.removeFromWorld(this.composite)
    super.destroy()
  }

  onRemoved(): void {
    super.onRemoved()
    this.removeFromWorld(this.composite)
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

  removeFromWorld(object: Body | Composite | Constraint) {
    if (this.parent.scene.physEngine.enabled) {
      Composite.remove(this.parent.scene.physEngine.world, object)
    }
  }

  get enabled() {
    return super.enabled
  }

  set enabled(v: boolean) {
    super.enabled = v
    if (v) {
      this.addToWorld(this.composite)
    } else {
      this.removeFromWorld(this.composite)
    }
  }
}
 */

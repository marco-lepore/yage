import { Container, Point, Transform } from 'pixi.js'
import { Component } from '../BaseComponent'
import { GameObject } from '../../GameObject'
import {
  Emitter,
  LinkedListContainer,
  EmitterConfigV3,
} from '@pixi/particle-emitter'

export class ParticlesEmitterComponent<
  Parent extends GameObject = GameObject,
> extends Component<Parent> {
  name = 'ParticlesEmitterComponent'
  private container = new LinkedListContainer()
  emitter: Emitter
  renderLayer?: Container
  constructor(
    parent: Parent,
    {
      config,
      linkedTransform,
      linkedTransformOffset,
      renderLayer,
      autoEmit,
    }: {
      config: EmitterConfigV3
      linkedTransform?: Transform
      linkedTransformOffset?: Point
      renderLayer?: Container
      autoEmit?: boolean
    },
  ) {
    super(parent)
    this.emitter = new Emitter(this.container, config)
    this.renderLayer = renderLayer
    if (linkedTransform) {
      this.linkTransform(linkedTransform, linkedTransformOffset)
      this.updateTransform()
      this.emitter.resetPositionTracking()
    }
    this.enabled = false
    this.emitter.emit = autoEmit ?? false
  }

  onAdded(): void {
    super.onAdded()
    if (this.renderLayer) {
      this.renderLayer.addChild(this.container)
    } else {
      this.parent.scene.display.addChild(this.container)
    }
    this.enabled = true
  }

  onRemoved(): void {
    super.onRemoved()
    if (this.container.parent) {
      this.container.parent.removeChild(this.container)
    }
    this.enabled = false
  }

  onTick(dt: number): void {
    super.onTick(dt)
    this.emitter.update(this.parent.scene.ticker.elapsedMS / 1000)
    this.updateTransform()
  }

  private linkedTransform: Transform | (() => Transform) | null = null
  linkTransform(
    transform: Transform | (() => Transform) | null,
    offset?: Point,
  ) {
    this.linkedTransform = transform
    this.linkedTransformOffset = offset ?? this.linkedTransformOffset
  }

  private linkedTransformOffset: Point = new Point(0, 0)
  setLinkedTransformOffset = (x: number, y: number) => {
    this.linkedTransformOffset = new Point(x, y)
  }

  updateTransform() {
    if (this.linkedTransform) {
      const transform =
        typeof this.linkedTransform === 'function'
          ? this.linkedTransform()
          : this.linkedTransform

      this.emitter.updateOwnerPos(
        transform.position.x + this.linkedTransformOffset.x,
        transform.position.y + this.linkedTransformOffset.y,
      )
    }
  }

  get enabled() {
    return super.enabled
  }

  set enabled(v: boolean) {
    super.enabled = v
    if (v) {
      this.updateTransform()
    }
    this.container.renderable = v
  }
}

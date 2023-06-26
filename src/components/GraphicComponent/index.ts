import {
  AnimatedSprite,
  Container,
  DisplayObject,
  Graphics,
  Point,
  Sprite,
  Transform,
} from 'pixi.js'
import { Component } from '../BaseComponent'
import { GameObject } from '../../GameObject'
import { CompositeTilemap } from '@pixi/tilemap'

export class GraphicComponent<
  Parent extends GameObject = GameObject,
> extends Component<Parent> {
  name = 'GraphicComponent'
  // container = new Container()
  graphic: Sprite | AnimatedSprite | Graphics | Container | CompositeTilemap
  renderLayer?: Container
  constructor(
    parent: Parent,
    {
      graphic,
      linkedTransform,
      renderLayer,
    }: {
      graphic: Sprite | AnimatedSprite | Graphics | Container | CompositeTilemap
      linkedTransform?: Transform
      renderLayer?: Container
    },
  ) {
    super(parent)
    this.graphic = graphic
    this.renderLayer = renderLayer
    if (linkedTransform) {
      this.linkTransform(linkedTransform)
    }
    this.enabled = false
  }

  onAdded(): void {
    super.onAdded()
    if (this.renderLayer) {
      this.renderLayer.addChild(this.graphic)
    } else {
      this.parent.scene.display.addChild(this.graphic)
    }
    this.enabled = true
  }

  onRemoved(): void {
    super.onRemoved()
    if (this.graphic.parent) {
      this.graphic.parent.removeChild(this.graphic)
    }
    this.enabled = false
  }

  onTick(dt: number): void {
    super.onTick(dt)

    this.updateTransform()
  }

  private linkedTransform: Transform | (() => Transform) | null = null
  linkTransform(transform: Transform | (() => Transform) | null) {
    this.linkedTransform = transform
  }

  private linkedTransformOffset: Point = new Point(0, 0)
  setLinkedTransformOffset = (x: number, y: number) => {
    this.linkedTransformOffset = new Point(x, y)
  }

  updateTransform() {
    if (this.isEnabled() && this.linkedTransform) {
      const transform =
        typeof this.linkedTransform === 'function'
          ? this.linkedTransform()
          : this.linkedTransform

      // maybe also update scale etc? or leave it to the graphic object

      this.graphic.setTransform(
        transform.position.x + this.linkedTransformOffset.x,
        transform.position.y + this.linkedTransformOffset.y,
        this.graphic.scale.x,
        this.graphic.scale.y,
        transform.rotation,
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
    this.graphic.renderable = v
  }
}

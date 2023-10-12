import { CompositeTilemap } from '@pixi/tilemap'
import { Component } from '../BaseComponent'
import { GameObject } from '../../GameObject'
import { objectsToRapierCollidersDesc } from '../../utils/tilemaps'
import { objectToRapierColliderDesc } from '../../utils/tilemaps'
import { parseMapAsset } from '../../utils/tilemaps'

export class TilemapComponent<
  Parent extends GameObject = GameObject,
> extends Component<Parent> {
  static objectToRapierColliderDesc = objectToRapierColliderDesc
  static objectsToRapierCollidersDescs = objectsToRapierCollidersDesc

  static parseMapAsset = parseMapAsset

  static createTilemapComponents = (
    parent: GameObject,
    tilemaps: CompositeTilemap[],
  ) => {
    return tilemaps.map((tilemap) =>
      parent.addComponent(TilemapComponent, tilemap),
    )
  }

  name = 'TilemapComponent'
  // data: { tilemap: CompositeTilemap; bodies: Body[] }[]

  tilemap: CompositeTilemap

  constructor(parent: Parent, tilemap: CompositeTilemap) {
    super(parent)

    this.tilemap = tilemap
  }

  onAdded(): void {
    super.onAdded()

    this.parent.scene.display.addChild(this.tilemap)
  }

  onRemoved(): void {
    super.onRemoved()

    this.parent.scene.display.removeChild(this.tilemap)
  }
}

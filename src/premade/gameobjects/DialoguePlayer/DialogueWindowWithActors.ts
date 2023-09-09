import { Sprite, Texture } from 'pixi.js'
import { Scene } from '../../../Scene'
import { DialogueMessage } from './types'
import { GraphicComponent, UITextComponent } from '../../../components'
import { DialogueWindow } from './DialogueWindow'

export type DialogueActor = {
  id: string
  texture: Texture
  name: string
}

export type DialogueMessageWithActorData = DialogueMessage & {
  actorId?: string
  position?: 'left' | 'right'
}

type Options<
  Parent extends Scene,
  Message extends DialogueMessage,
> = ConstructorParameters<typeof DialogueWindow<Parent, Message>>[1] & {
  actors: Record<string, DialogueActor>
}

export class DialogueWindowWithActors<
  Parent extends Scene = Scene,
  Message extends DialogueMessageWithActorData = DialogueMessageWithActorData,
> extends DialogueWindow<Parent, Message> {
  actors: Record<string, DialogueActor> = {}
  portraitComponent: GraphicComponent<typeof this, Sprite>
  actorNameComponent: UITextComponent
  constructor(
    parent: Parent,
    {
      window,
      cursor,
      position,
      padding,
      textStyle,
      lines,
      actors,
    }: Options<Parent, Message>,
  ) {
    super(parent, { window, cursor, position, padding, textStyle, lines })
    this.actors = actors

    const emptySprite = Sprite.from(Texture.EMPTY)
    emptySprite.anchor.set(0, 0)

    this.portraitComponent = this.addComponent(
      GraphicComponent<typeof this, Sprite>,
      {
        graphic: emptySprite,
        renderLayer: this.windowComponent.graphic,
      },
    )

    textStyle.fontSize = window.height / 6
    textStyle.stroke = 0x000000
    textStyle.strokeThickness = 4
    textStyle.fill = 0xFFFFFF

    this.actorNameComponent = this.addComponent(UITextComponent, {
      text: '',
      style: textStyle,
      renderLayer: this.windowComponent.graphic,
    })

    this.actorNameComponent.textElement.anchor.set(1, 1)
  }

  protected updateTextLayout(): void {
    super.updateTextLayout()
    const { actorId, position } = this.currentMessage
    const actor = this.actors[actorId]
    const {
      graphic: { width, height },
    } = this.windowComponent
    const [top, left, bottom, right] = this.padding

    if (!actorId) {
      this.portraitComponent.enabled = false
      this.actorNameComponent.enabled = false
      const cursorX = width - right
      const cursorY = height - bottom
      this.cursorComponent.graphic.position.set(cursorX, cursorY)
      return
    }
    if (!actor) {
      throw new Error(`actor ${actorId} does not exist`)
    }

    const availWidth = width - left - right

    const portraitHeight = height
    const portraitWidth = height

    const portraitMargin = position === 'left' ? left : right

    const textWidth = availWidth - portraitWidth - portraitMargin

    this.portraitComponent.graphic.texture = actor.texture
    this.portraitComponent.graphic.width = portraitWidth
    this.portraitComponent.graphic.height = portraitHeight
    this.actorNameComponent.setText(actor.name)
    if (position === 'left') {
      this.portraitComponent.graphic.position.set(0, 0)
      this.actorNameComponent.setPosition(portraitWidth, portraitHeight)
      this.textComponent.textElement.style.wordWrapWidth = textWidth
      // this.textComponent.textElement.maxWidth = textWidth
      this.textComponent.setPosition(left + portraitWidth + portraitMargin, top)

      const cursorX = width - right
      const cursorY = height - bottom
      this.cursorComponent.graphic.position.set(cursorX, cursorY)
    } else {
      this.portraitComponent.graphic.position.set(width - portraitWidth, 0)
      this.actorNameComponent.setPosition(width, portraitHeight)
      this.textComponent.textElement.style.wordWrapWidth = textWidth

      //      this.textComponent.textElement.maxWidth = textWidth
      this.textComponent.setPosition(left, top)

      const cursorX = left + textWidth
      const cursorY = height - bottom
      this.cursorComponent.graphic.position.set(cursorX, cursorY)
    }

    this.portraitComponent.enabled = true
    this.actorNameComponent.enabled = true
  }

  stop(): void {
    super.stop()
    this.portraitComponent.enabled = false
    this.actorNameComponent.enabled = false
  }
}

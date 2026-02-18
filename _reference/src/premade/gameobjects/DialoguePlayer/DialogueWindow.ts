import { Container, Point, Sprite, TextStyle } from 'pixi.js'
import { GameObject } from '../../../GameObject'
import { Scene } from '../../../Scene'
import { DialogueMessage, DialogueNode } from './types'
import { GraphicComponent, UITextComponent } from '../../../components'
import { Process } from '../../../Process'

type TextPadding = [number, number, number, number]

type DialogueWindowOptions = {
  window: Container
  cursor: Sprite
  position: Point
  padding: TextPadding
  textStyle: TextStyle
  lines?: number
}

type UpdateTextEvent<Message> = {
  complete: boolean
  message: Message
}

export class DialogueWindow<
  Parent extends Scene = Scene,
  Message extends DialogueMessage = DialogueMessage,
> extends GameObject<Parent> {
  groupComponent: GraphicComponent
  windowComponent: GraphicComponent
  cursorComponent: GraphicComponent
  position: Point
  textComponent: UITextComponent
  currentMessageIndex = 0
  dialogueNode: DialogueNode<Message>
  padding: TextPadding
  lines: number
  constructor(
    parent: Parent,
    {
      window,
      cursor,
      position,
      padding,
      textStyle,
      lines,
    }: DialogueWindowOptions,
  ) {
    super(parent)
    this.lines = lines
    this.padding = padding
    this.position = position

    const groupContainer = new Container()
    groupContainer.sortableChildren = true
    groupContainer.position.set(position.x, position.y)

    this.groupComponent = this.addComponent(GraphicComponent, {
      graphic: groupContainer,
    })

    this.windowComponent = this.addComponent(GraphicComponent, {
      graphic: window,
      renderLayer: groupContainer,
    })
    this.windowComponent.enabled = false

    const updatedStyle = this.createTextStyle(textStyle, padding, lines)
    this.textComponent = this.addComponent(UITextComponent, {
      text: 'abc,.- ',
      x: 0,
      y: 0,
      style: updatedStyle,
      renderLayer: window,
    })

    this.cursorComponent = this.addComponent(GraphicComponent, {
      graphic: cursor,
      renderLayer: window,
    })
    this.cursorComponent.enabled = false

    this.textComponent.textElement.zIndex = 1
    this.windowComponent.graphic.zIndex = -1
    this.textComponent.textElement.anchor.set(0, 0)
  }

  createTextStyle(baseStyle: TextStyle, padding: TextPadding, lines?: number) {
    const clone = baseStyle.clone()
    const {
      graphic: { height },
    } = this.windowComponent

    const [top, bottom] = padding
    clone.align = 'left'
    clone.wordWrap = true

    if (lines !== undefined) {
      const textHeight = height - top - bottom
      clone.lineHeight = textHeight / lines
      clone.fontSize = clone.lineHeight * 0.8
    }

    return clone
  }

  start<M extends Message>(node: DialogueNode<M>) {
    this.currentMessageIndex = 0
    this.dialogueNode = node
    this.windowComponent.enabled = true
    this.textComponent.enabled = true
    this.show()
  }

  isPlaying = false
  currentTextIndex = 0
  currentMessageComplete = false

  get currentMessage() {
    return this.dialogueNode.messages[this.currentMessageIndex]
  }

  get currentMessageText() {
    return this.currentMessage.text
  }

  private textTween?: Process

  private textUpdateListeners: ((data: UpdateTextEvent<Message>) => void)[] = []

  onTextUpdate = (listener: (data: UpdateTextEvent<Message>) => void) => {
    this.textUpdateListeners.push(listener)
    return () => {
      this.textUpdateListeners = this.textUpdateListeners.filter(
        (l) => l !== listener,
      )
    }
  }

  clearTextUpdateListeners = () => {
    this.textUpdateListeners = []
  }

  show() {
    this.currentMessage.onEnter?.()
    this.currentTextIndex = 0
    this.cursorComponent.enabled = false
    this.updateText()
    this.updateTextLayout()

    const duration = this.currentMessageText.length * 25
    this.textTween = Process.tween(
      this.showTextProgressively,
      0,
      this.currentMessageText.length,
      duration,
      'linear',
    )
  }

  protected showTextProgressively = (n: number) => {
    const index = Math.floor(n)
    const complete = index === this.currentMessageText.length
    if (index > this.currentTextIndex) {
      this.currentTextIndex = index
      this.updateText()

      this.textUpdateListeners.forEach((listener) =>
        listener({ complete, message: this.currentMessage }),
      )
    }
    if (complete) {
      this.currentTextIndex = index
      this.updateText()
      this.textTweenCompleted()
    }
  }

  protected textTweenCompleted() {
    this.updateText()
    this.currentMessageComplete = true
    this.textTween.destroy()
    delete this.textTween
    this.cursorComponent.enabled = true
  }

  protected updateTextLayout() {
    const {
      graphic: { width },
    } = this.windowComponent

    const [top, right, left] = this.padding
    const { textElement } = this.textComponent

    //textElement.maxWidth = width - right - left
    textElement.style.wordWrapWidth = width - right - left
    textElement.updateText(false)
    this.textComponent.setPosition(left, top)
  }

  updateText() {
    const message = this.currentMessageText.slice(0, this.currentTextIndex)
    this.textComponent.setText(message)
  }

  advance() {
    if (this.textTween) {
      this.currentTextIndex = this.currentMessageText.length
      this.updateText()
      this.textTweenCompleted()
      return false
    }

    this.currentMessage.onExit?.()
    this.currentMessageIndex++

    if (this.dialogueNode.messages[this.currentMessageIndex]) {
      this.show()
      return false
    } else {
      this.stop()
      return true
    }
  }

  stop() {
    this.currentMessageIndex = 0
    this.windowComponent.enabled = false
    this.textComponent.setText('')
    this.textComponent.enabled = false
    this.cursorComponent.enabled = false
  }
}

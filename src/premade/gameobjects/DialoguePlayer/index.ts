import { DisplayObject } from 'pixi.js'
import { GameObject } from '../../../GameObject'
import { Scene } from '../../../Scene'
import type { Dialogue } from './types'
import { DialogueWindow } from './DialogueWindow'

const example: Dialogue = {
  data: {
    start: {
      id: 'start',
      messages: [],
      next: 'end',
    },
    end: {
      id: 'end',
      messages: [],
      next: null,
    },
  },
  initial: 'start',
}

export class DialoguePlayer<
  Parent extends Scene<any, any> = Scene<any, any>,
  D extends Dialogue = Dialogue,
> extends GameObject<Parent> {
  dialogue?: D
  currentNode?: string
  dialogueWindow: DialogueWindow<Parent, any>
  constructor(parent: Parent, dialogueWindow: DialogueWindow<Parent, any>) {
    super(parent)
    this.dialogueWindow = dialogueWindow
  }

  play(dialogue: D) {
    const { data, initial } = dialogue
    this.dialogue = dialogue
    this.currentNode = initial
    this.dialogueWindow.start(data[this.currentNode])
  }

  advance() {
    if (!this.dialogue || !this.currentNode) {
      return
    }
    const done = this.dialogueWindow.advance()
    if (done) {
      const node = this.dialogue.data[this.currentNode]
      if (!node.final && typeof node.next === 'string') {
        this.currentNode = node.next
        const nextNode = this.dialogue.data[this.currentNode]
        this.dialogueWindow.start(nextNode)
      } else {
        this.dialogueWindow.stop()
        this.dialogue = undefined
        this.currentNode = undefined
      }
    }
  }
}

export * from './types'
export * from './DialogueWindow'
export * from './DialogueWindowWithActors'
export * from './utils'

import { Executor } from '../../Executor'
import { GameObject } from '../../GameObject'
import { Component } from '../BaseComponent'

export class InputComponent<
  Parent extends GameObject = GameObject,
> extends Component<Parent> {
  name = 'PlayerInput'
  keymap: Map<string, string[]>

  constructor(
    parent: Parent,
    defaultMapping: Map<string, string[]> = new Map<string, string[]>(),
  ) {
    super(parent)
    this.keymap = defaultMapping
  }

  addInput(input: string, keycode: string) {
    const previous = this.keymap.get(input)
    this.keymap.set(input, previous ? [...previous, keycode] : [keycode])
  }

  replaceInput(input: string, keycode: string) {
    this.keymap.set(input, [keycode])
  }

  deleteInput(input: string) {
    this.keymap.delete(input)
  }

  replaceKeymap(newMapping: Map<string, string[]>) {
    this.keymap = newMapping
  }

  isInputActive(input: string) {
    if (this.isEnabled() && Executor.ctx.game) {
      const game = Executor.ctx.game
      if (!this.keymap.has(input)) {
        throw new Error(`${this.name}: input ${input} doesn't exist`)
      }
      const keys = this.keymap.get(input) as string[]
      return keys.some((key) => game.playerInput[key])
    }
    return false
  }
}

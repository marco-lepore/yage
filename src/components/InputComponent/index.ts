import { Executor } from '../../Executor'
import { GameObject } from '../../GameObject'
import { Component } from '../BaseComponent'

export class InputComponent<
  Parent extends GameObject = GameObject,
> extends Component<Parent> {
  name = 'PlayerInput'
  keymap: Map<string, string[]>
  runOnFixedUpdate = true

  constructor(
    parent: Parent,
    defaultMapping: Map<string, string[]> = new Map<string, string[]>(),
    runOnFixedUpdate = true,
  ) {
    super(parent)
    this.keymap = defaultMapping
    this.runOnFixedUpdate = runOnFixedUpdate
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

  justPressed = new Set<string>()
  active = new Set<string>()
  justReleased = new Set<string>()
  holding = new Map<string, number>()

  onBeforeFixedTick(elapsedMS: number): void {
    super.onBeforeFixedTick(elapsedMS)
    if (this.runOnFixedUpdate) {
      this.updateAllInputState(elapsedMS)
    }
  }

  onBeforeTick(dt: number): void {
    const elapsedMS = this.parent.scene.ticker.elapsedMS
    super.onBeforeTick(dt)
    if (!this.runOnFixedUpdate) {
      this.updateAllInputState(elapsedMS)
    }
  }

  updateAllInputState(elapsedMS: number) {
    if (!this.isEnabled() || !Executor.ctx.game) {
      return
    }
    const game = Executor.ctx.game
    this.keymap.forEach((keys, input) => {
      const isActive = keys.some((key) => game.playerInput[key])
      this.updateSingleInputState(input, isActive, elapsedMS)
    })
  }

  updateSingleInputState(input: string, isActive: boolean, elapsedMS: number) {
    // key is pressed
    if (isActive) {
      if (!this.active.has(input)) {
        // key was just pressed this frame
        // add "just pressed" state
        this.justPressed.add(input)
        // add to active inputs
        this.active.add(input)
        // initialize hold time to 0
        this.holding.set(input, 0)
      } else {
        // key has been pressed for n frames
        // remove "just pressed" state
        this.justPressed.delete(input)
        // update hold time
        const holdTime = this.holding.get(input)
        this.holding.set(input, holdTime + elapsedMS)
      }
    } else {
      // key is not pressed
      if (this.active.has(input)) {
        // key was just released
        // remove from active keys
        this.active.delete(input)
        // probably no effect but remove from just pressed just in case
        this.justPressed.delete(input)
        // remove entry from hold time map
        this.holding.delete(input)
        // add "just released" state
        this.justReleased.add(input)
      } else if (this.justReleased.has(input)) {
        // key was released for 1 frame
        this.justReleased.delete(input)
      }
    }
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

  isJustPressed(input: string) {
    return this.justPressed.has(input)
  }

  isJustReleased(input: string) {
    return this.justReleased.has(input)
  }

  isActive(input: string) {
    return this.active.has(input)
  }

  isHoldingFor(input: string, minTime: number) {
    return this.holding.has(input) && this.holding.get(input) > minTime
  }

  getHoldingTime(input: string) {
    return this.holding.get(input) ?? null
  }
}

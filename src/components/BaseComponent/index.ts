import { GameObject } from '../../GameObject'

const enabled = Symbol('enabled')

export class Component<Parent extends GameObject = GameObject> {
  name = 'component'
  private _parent!: Parent
  get parent() {
    if (!this._parent) {
      throw new Error(`Component ${this.name} is orphan`)
    }
    return this._parent
  }
  set parent(p: Parent) {
    this._parent = p
  }

  tags: string[] = []

  private [enabled] = true

  get enabled() {
    return this[enabled]
  }

  set enabled(v: boolean) {
    this[enabled] = v
  }

  constructor(parent: Parent) {
    this.parent = parent
    this.setup()
  }

  setParent(parent: Parent) {
    this.parent = parent
  }

  private setup() {}

  private teardown() {}

  destroy() {
    this.teardown()
  }

  setupEventListeners() {}

  onBeforeTick(dt: number) {}

  onTick(dt: number) {}

  onBeforeFixedTick(elapsedMS: number) {}

  onFixedTick(elapsedMS: number) {}

  onAfterFixedTick(elapsedMS: number) {}

  onAfterTick(dt: number) {}

  onAdded() {}

  onRemoved() {}

  isEnabled() {
    return this.enabled
  }
}

type ObjectPoolOptions<T> = {
  onCreate: () => T
  onDispose: (element: T) => void
  onDestroy: (element: T) => void
  prefill?: number
}

export class ObjectPool<T> {
  private onCreate: () => T
  private onDispose: (element: T) => void
  private onDestroy: (element: T) => void

  private available: T[] = []
  private inUse: Set<T> = new Set()

  constructor(options: ObjectPoolOptions<T>) {
    const { onCreate, onDispose, onDestroy, prefill } = options
    this.onCreate = onCreate
    this.onDispose = onDispose
    this.onDestroy = onDestroy

    if (prefill) {
      this.fill(prefill)
    }
  }

  getInstance() {
    let instance = this.available.pop()
    if (!instance) {
      instance = this.onCreate()
    }

    this.inUse.add(instance)
    return instance
  }

  disposeInstance(instance: T) {
    if (!this.inUse.has(instance)) {
      throw new Error('instance already disposed')
    }
    this.onDispose(instance)
    this.inUse.delete(instance)
    this.available.push(instance)
  }

  shrink() {
    this.available.forEach(this.onDestroy)
    this.available = []
  }

  fill(n: number) {
    for (let index = 0; index < n; index++) {
      this.available.push(this.onCreate())
    }
  }
}

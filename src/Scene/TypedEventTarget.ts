export class TickEvent extends CustomEvent<{ dt: number }> {
  constructor(dt: number) {
    super('tick', { detail: { dt } })
  }
}

export type CustomEventMap = Record<string, CustomEvent>

export class TypedEventTarget<
  EventMap extends CustomEventMap = CustomEventMap,
> extends EventTarget {
  public dispatchEvent(e: EventMap[keyof EventMap]): boolean {
    return super.dispatchEvent(e)
  }

  public addEventListener<T extends keyof EventMap = keyof EventMap>(
    type: T,
    listener: ((e: EventMap[T]) => void) | EventListenerObject | null,
  ) {
    super.addEventListener(type as string, listener as EventListener)
  }

  public removeEventListener<T extends keyof EventMap = keyof EventMap>(
    type: T,
    listener: ((e: EventMap[T]) => void) | EventListenerObject | null,
  ) {
    super.removeEventListener(type as string, listener as EventListener)
  }
}

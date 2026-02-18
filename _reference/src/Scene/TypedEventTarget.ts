import { AnyEvents } from './types'

export class TypedEventTarget<
  Events extends AnyEvents = AnyEvents,
> extends EventTarget {
  public dispatchEvent(event: Events[keyof Events]): boolean {
    return super.dispatchEvent(event)
  }

  public addEventListener<T extends keyof Events>(
    type: T,
    listener: ((event: Events[T]) => void) | EventListenerObject | null,
  ) {
    super.addEventListener(type as string, listener as EventListener)
  }

  public removeEventListener<T extends keyof Events>(
    type: T,
    listener: ((event: Events[T]) => void) | EventListenerObject | null,
  ) {
    super.removeEventListener(type as string, listener as EventListener)
  }
}

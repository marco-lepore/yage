import { Ticker as PixiTicker } from 'pixi.js'

export class Ticker extends PixiTicker {
  start(): void {
    if (!this.started) {
      super.start()
    }
  }

  stop(): void {
    if (this.started) {
      super.stop()
    }
  }

  private setup() {
    window.addEventListener('focusout', this.stop)
    window.addEventListener('focusin', this.start)
  }

  private teardown() {
    window.removeEventListener('focusout', this.stop)
    window.removeEventListener('focusin', this.start)
  }

  constructor(fixedFps?: number) {
    super()
    if (fixedFps) {
      this.maxFPS = fixedFps
      this.minFPS = fixedFps
    }
    this.setup()
  }

  destroy(): void {
    this.teardown()
    super.destroy()
  }
}

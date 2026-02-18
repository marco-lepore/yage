import { Scene } from '../../Scene'
import { getGame } from '../../utils'

export class LoadingScene extends Scene<{ next: Scene }> {
  onLoad() {
    super.onLoad()
  }

  onTransitionCompleted(): void {
    this.loadNext()
  }

  async loadNext() {
    const { next } = this.state
    await next.preload(this.onProgress, false)

    await getGame().transitionTo(next)
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onProgress(n: number) {}
}

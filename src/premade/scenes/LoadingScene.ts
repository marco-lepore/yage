import { Scene } from '../../Scene'
import { getGame } from '../../utils'

export class LoadingScene extends Scene<{ next: Scene<any, any> }, any> {
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

  onProgress(n: number) {}
}

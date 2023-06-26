import { IMediaInstance, PlayOptions, sound } from '@pixi/sound'
import { Component } from '../BaseComponent'
import { GameObject } from '../../GameObject'

export class AudioComponent<
  Parent extends GameObject = GameObject,
> extends Component<Parent> {
  name = 'AudioComponent'
  cache: Set<IMediaInstance> = new Set()

  onAdded(): void {
    super.onAdded()
  }

  onRemoved(): void {
    super.onRemoved()
    this.clearCache()
  }

  clearCache(): void {
    this.cache.forEach((s) => {
      s.destroy()
      this.cache.delete(s)
    })
  }

  async play(alias: string, options?: PlayOptions) {
    const s = await sound.play(alias, options)
    this.cache.add(s)
    s.on('end', () => this.cache.delete(s))
    return s
  }

  stop(alias: string) {
    sound.stop(alias)
  }

  pause(alias: string) {
    return sound.pause(alias)
  }

  resume(alias: string) {
    return sound.resume(alias)
  }

  volume(alias: string, n?: number) {
    return sound.volume(alias, n)
  }

  volumeAll(n: number) {
    this.cache.forEach((s) => (s.volume = n))
  }

  find(alias: string) {
    return sound.find(alias)
  }

  findInstances(alias: string) {
    return sound.find(alias).instances
  }

  get enabled() {
    return super.enabled
  }

  set enabled(v: boolean) {
    super.enabled = v
    if (!v) {
      this.clearCache()
    }
  }
}

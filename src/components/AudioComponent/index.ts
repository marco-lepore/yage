import { IMediaInstance, PlayOptions, sound } from '@pixi/sound'
import { Component } from '../BaseComponent'
import { GameObject } from '../../GameObject'
import { getRandomValueInArray } from '../../utils'

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
      s.stop()
      s.destroy()
      this.cache.delete(s)
    })
  }

  async play(alias: string, options?: PlayOptions) {
    const s = await sound.play(alias, options)
    this.cache.add(s)
    await new Promise<void>((resolve) => {
      s.on('end', () => {
        this.cache.delete(s)
        resolve()
      })
    })
    return s
  }

  async playRandom(aliases: string[], options?: PlayOptions) {
    const alias = getRandomValueInArray(aliases)
    await this.play(alias, options)
  }

  isPlaying() {
    return this.cache.size > 0
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

  destroy(): void {
    super.destroy()
    this.clearCache()
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

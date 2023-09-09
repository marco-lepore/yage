import { last, mapValues } from 'lodash'
import { GameObject } from '../../GameObject'
import { Component } from '../BaseComponent'
import { EASINGS, Easing, Interpolatable, interpolate } from '../../utils'

export type Keyframe<T extends Interpolatable> = {
  time: number
  data: T
  easing?: keyof typeof EASINGS | ((t: number) => number)
}

export type Animation<T extends Interpolatable> = {
  predicate: (data: T) => void
  keyframes: Keyframe<T>[]
  loop?: boolean
  speed?: number
  duration?: number
  easing?: Easing // https://developer.mozilla.org/en-US/docs/Web/CSS/easing-function
  runOnFixedUpdate?: boolean
}

export class AnimationControllerComponent<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Animations extends Record<string, Animation<any>>,
  Parent extends GameObject = GameObject,
> extends Component<Parent> {
  name = 'AnimationControllerComponent'
  animations: { [key in keyof Animations]: Animations[keyof Animations] }
  private currentAnimation?: Animations[keyof Animations]
  private currentTime = 0
  private paused = false

  constructor(parent: Parent, animations: Animations) {
    super(parent)
    this.animations = this.normalizeAnimations(animations)
  }

  normalizeAnimations(animations: Animations): {
    [key in keyof Animations]: Animations[keyof Animations]
  } {
    const normalizedAnimations = mapValues(animations, (animation) => {
      const keyframes = [...animation.keyframes]

      keyframes.sort((a, b) => (a.time > b.time ? 1 : -1))

      let duration = animation.duration
      if (duration) {
        if (duration > last(keyframes).time) {
          keyframes.push({
            ...last(keyframes),
            time: duration,
          })
        }
      } else {
        duration = last(keyframes).time
      }
      const normalizedAnimation = {
        ...animation,
        keyframes,
        duration,
        speed: animation.speed === undefined ? 1 : animation.speed,
      }

      return normalizedAnimation
    })
    return normalizedAnimations
  }

  play(name: keyof Animations, restart = false) {
    const animation = this.animations[name]
    if (this.currentAnimation === animation && !restart) {
      return
    }
    this.currentAnimation = animation
    this.currentTime = 0
  }

  setPaused(v: boolean) {
    this.paused = v
  }

  stop() {
    this.currentAnimation = undefined
  }

  onTick(dt: number): void {
    super.onTick(dt)
    if (
      !this.paused &&
      this.currentAnimation &&
      !this.currentAnimation.runOnFixedUpdate
    ) {
      const elapsedMS = this.parent.scene.ticker.deltaMS
      this.execute(elapsedMS)
    }
  }

  onFixedTick(elapsedMS: number): void {
    super.onFixedTick(elapsedMS)
    if (
      !this.paused &&
      this.currentAnimation &&
      this.currentAnimation.runOnFixedUpdate
    ) {
      this.execute(elapsedMS)
    }
  }

  execute(elapsedMS: number): void {
    if (!this.currentAnimation) {
      return
    }
    const { duration, speed, loop, keyframes, predicate, easing } =
      this.currentAnimation
    this.currentTime += elapsedMS * speed

    if (!loop && this.currentTime > duration) {
      this.stop()
      return
    }

    let nextKeyframeIndex = keyframes.findIndex(
      (kf) => kf.time > this.currentTime % duration,
    )

    nextKeyframeIndex = nextKeyframeIndex === -1 ? 0 : nextKeyframeIndex

    const currentKeyframeIndex =
      nextKeyframeIndex >= 0 ? nextKeyframeIndex - 1 : keyframes.length - 1

    const {
      time: currentTime,
      data: currentData,
      easing: frameEasing,
    } = keyframes[currentKeyframeIndex]
    const { time: nextTime, data: _nextData } = keyframes[nextKeyframeIndex]

    const t =
      ((this.currentTime % duration) - currentTime) / (nextTime - currentTime)

    const easingFromOptions = frameEasing ?? easing ?? 'linear'
    const nextData = _nextData as typeof currentData

    const interpolatedValue = interpolate(
      currentData,
      nextData,
      t,
      easingFromOptions,
    )

    predicate(interpolatedValue)
  }
}

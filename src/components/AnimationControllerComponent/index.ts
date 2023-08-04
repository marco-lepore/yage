import { first, isObject, last, mapValues } from 'lodash'
import { GameObject } from '../../GameObject'
import { Component } from '../BaseComponent'
import { getCubicBezierEasing, lerp } from '../../utils'

const EASINGS = {
  linear: (t: number) => t,
  ease: getCubicBezierEasing(0.25, 0.1, 0.25, 1.0),
  easeIn: getCubicBezierEasing(0.42, 0.0, 1.0, 1.0),
  easeOut: getCubicBezierEasing(0.0, 0.0, 0.58, 1.0),
  easeInOut: getCubicBezierEasing(0.42, 0.0, 0.58, 1.0),
  holdStart: (t: number) => (t === 1 ? t : 0),
  jumpEnd: (t: number) => (t === 0 ? t : 1),
}

type Easing = keyof typeof EASINGS | ((t: number) => number)

export type Keyframe<T> = {
  time: number
  data: T
  easing?: keyof typeof EASINGS | ((t: number) => number)
}

type Animatable = number | Record<string | number, number> | number[]

export type Animation<T extends Animatable> = {
  predicate: (data: T) => void
  keyframes: Keyframe<T>[]
  loop?: boolean
  speed: number
  duration?: number
  easing?: Easing // https://developer.mozilla.org/en-US/docs/Web/CSS/easing-function
  runOnFixedUpdate?: boolean
}

export class AnimationControllerComponent<
  Parent extends GameObject = GameObject,
  Animations extends Record<string, Animation<any>> = Record<
    string,
    Animation<any>
  >,
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
      const keyframes = Array.from(animation.keyframes)

      keyframes.sort((a, b) => (a.time > b.time ? 1 : -1))

      let duration = animation.duration
      if (!duration) {
        duration = last(keyframes).time
      } else {
        if (duration > last(keyframes).time) {
          keyframes.push({
            ...last(keyframes),
            time: duration,
          })
        }
      }
      const normalizedAnimation = { ...animation, keyframes, duration }

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
      nextKeyframeIndex > 0 ? nextKeyframeIndex - 1 : keyframes.length - 1

    const {
      time: currentTime,
      data: currentData,
      easing: frameEasing,
    } = keyframes[currentKeyframeIndex]
    const { time: nextTime, data: _nextData } = keyframes[nextKeyframeIndex]

    const t =
      ((this.currentTime % duration) - currentTime) / (nextTime - currentTime)

    let interpolatedValue: Animatable

    const easingFromOptions = frameEasing ?? easing ?? 'linear'

    const easingFn =
      typeof easingFromOptions === 'function'
        ? easingFromOptions
        : EASINGS[easingFromOptions]
    const easedT = easingFn(t)

    if (typeof currentData === 'number') {
      const nextData = _nextData as typeof currentData
      interpolatedValue = lerp(currentData, nextData, easedT)
    } else if (Array.isArray(currentData)) {
      const nextData = _nextData as typeof currentData
      interpolatedValue = currentData.map((current, index) => {
        const next = nextData[index]
        return lerp(current, next, easedT)
      })
    } else {
      const nextData = _nextData as typeof currentData
      interpolatedValue = mapValues(currentData, (current, key) => {
        const next = nextData[key]
        return lerp(current, next, easedT)
      })
    }

    predicate(interpolatedValue)

    // Interpolate values
    // Execute predicate
    // check loop
  }
}

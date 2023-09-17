import { last, mapValues } from 'lodash'
import { GameObject } from '../../GameObject'
import { Component } from '../BaseComponent'
import { EASINGS, Easing, Interpolatable, interpolate } from '../../utils'

export type Keyframe<T extends Interpolatable> = {
  time: number
  data: T
  easing?: keyof typeof EASINGS | ((t: number) => number)
  event?: () => void
}

export type Animation<T extends Interpolatable> = {
  predicate: (data: T) => void
  keyframes: Keyframe<T>[]
  loop?: boolean
  speed?: number
  duration?: number
  easing?: Easing // https://developer.mozilla.org/en-US/docs/Web/CSS/easing-function
  runOnFixedUpdate?: boolean
  onEnter?: () => void
  onExit?: (complete: boolean) => void
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
  private loops = 0
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
    if (this.currentAnimation && this.currentAnimation !== animation) {
      this._stop(false)
    }
    this.currentAnimation = animation
    this.loops = 0
    this.currentTime = -this.currentAnimation.speed
    this.currentAnimation.onEnter?.()
    this.execute(this.currentAnimation.speed)
  }

  setPaused(v: boolean) {
    this.paused = v
  }

  private _stop(complete: boolean) {
    this.currentAnimation.onExit?.(complete)
    this.currentAnimation = undefined
  }

  stop() {
    this._stop(false)
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
    const previousTime = this.currentTime
    this.currentTime += elapsedMS * speed
    const currentTime = this.currentTime

    if (this.currentTime > duration * (this.loops + 1)) {
      this.loops++
    }

    const timelineLoops = loop
      ? (this.loops === 0
        ? [this.loops, this.loops + 1]
        : [this.loops - 1, this.loops, this.loops + 1])
      : [0]

    const timelineKeyframes = timelineLoops.flatMap((loopNumber) =>
      keyframes.map((frame) => ({
        ...frame,
        time: frame.time + duration * loopNumber,
      })),
    )

    let nextKeyframeIndex = timelineKeyframes.findIndex(
      (kf) => kf.time > this.currentTime,
    )

    nextKeyframeIndex = nextKeyframeIndex === -1 ? 0 : nextKeyframeIndex

    const currentKeyframeIndex =
      nextKeyframeIndex >= 0
        ? nextKeyframeIndex - 1
        : timelineKeyframes.length - 1

    const {
      time: currentFrameTime,
      data: currentFrameData,
      easing: currentFrameEasing,
    } = timelineKeyframes[currentKeyframeIndex]
    const { time: nextTime, data: _nextData } =
      timelineKeyframes[nextKeyframeIndex]

    const t = (currentTime - currentFrameTime) / (nextTime - currentFrameTime)

    const easingFromOptions = currentFrameEasing ?? easing ?? 'linear'
    const nextData = _nextData as typeof currentFrameData

    const interpolatedValue = interpolate(
      currentFrameData,
      nextData,
      t,
      easingFromOptions,
    )

    predicate(interpolatedValue)
    const events = timelineKeyframes.reduce((events, frame) => {
      if (
        frame.event &&
        frame.time > previousTime &&
        frame.time <= currentTime
      ) {
        events.push(frame.event)
      }
      return events
    }, [] as (() => void)[])

    events.forEach((event) => event())

    if (!loop && this.currentTime > duration) {
      this._stop(true)
    }
  }
}

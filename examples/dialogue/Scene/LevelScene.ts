import { ColliderDesc, RigidBodyDesc, Vector2 } from '@dimforge/rapier2d'
import {
  AnimationControllerComponent,
  GameObject,
  GraphicComponent,
  RapierBodyComponent,
  Scene,
  getPlayAreaBounds,
  pu,
  Animation,
  Keyframe,
  InputComponent,
  UITextComponent,
  Process,
  DialoguePlayer,
  Dialogue,
  AudioComponent,
  templateToMessages,
  DialogueWindowWithActors,
  DialogueMessageWithActorData,
} from '../../../src'
import {
  Graphics,
  NineSlicePlane,
  Point,
  SCALE_MODES,
  Sprite,
  TextStyle,
  Texture,
} from 'pixi.js'

const example: Dialogue<DialogueMessageWithActorData> = {
  data: {
    start: {
      id: 'start',
      messages: [
        {
          text: 'Dialogue system example. ',
          onEnter() {
            console.log('dialogue started')
          },
        },
        {
          text: "This is the dialogue system. It's pretty basic and a bit hard to customize, but it works (mostly)",
        },
        {
          actorId: 'seizar',
          position: 'left',
          text: 'Look, it supports actors too!',
        },
        {
          actorId: 'calliopae',
          position: 'right',
          text: 'With different portrait positions!',
        },
        {
          actorId: 'seizar',
          position: 'left',
          text: "And the voices! ... well I wouldn't call these voices...",
        },
        {
          actorId: 'calliopae',
          position: 'right',
          text: 'Technically you could add playback for voice acting pretty quickly though',
        },
        {
          actorId: 'seizar',
          position: 'left',
          text: "If you check the console, you'll see that events on messages are also supported",
          onEnter: () =>
            console.log(
              "Seizar: Yup! I'm writing here from an event. By accessing the Executor you can modify the game state from here",
            ),
        },
      ],
      next: 'end',
      final: false,
    },
    end: {
      id: 'end',
      messages: templateToMessages(`
      There is also support for writing dialogues in a template string.
      It doesn't support actors yet, but it wouldn't be too hard to implement.

      Anyway it should be ok for writing quickly some basic stuff.

      And that's it!
      `),
      final: true,
      next: null,
    },
  },
  initial: 'start',
}

class CustomDialogueWindow extends DialogueWindowWithActors {
  constructor(parent: LevelScene) {
    const { width, height } = getPlayAreaBounds()
    const window = new NineSlicePlane(Texture.from('panel'), 10, 10, 10, 10)
    const margin = 10
    window.width = width - margin * 2

    window.height = height / 4 - margin * 2
    window.position.set(margin, margin)
    window.pivot.set(0, 0)

    const cursor = Sprite.from('tick')
    cursor.scale.set(0.5)
    cursor.position.set(
      window.width - cursor.width,
      window.height - cursor.height,
    )
    cursor.anchor.set(0.5, 0.5)

    const seizarTexture = Texture.from('seizar-avatar')
    seizarTexture.baseTexture.scaleMode = SCALE_MODES.LINEAR

    const calliopaeTexture = Texture.from('calliopae-avatar')
    calliopaeTexture.baseTexture.scaleMode = SCALE_MODES.LINEAR

    const actors = {
      seizar: {
        id: 'seizar',
        name: 'Seizar',
        texture: seizarTexture,
        voices: ['tone1', 'tone2', 'tone3'],
      },
      calliopae: {
        id: 'calliopae',
        name: 'Calliopae',
        texture: calliopaeTexture,
        voices: ['tone1hi', 'tone2hi', 'tone3hi'],
      },
    }

    super(parent, {
      window,
      cursor,
      position: new Point(0, (height * 3) / 4),
      padding: [15, 15, 15, 15],
      lines: 4,
      textStyle: new TextStyle({
        fill: 0x222222,
        fontSize: 100,
      }),
      actors,
    })

    const audio = this.addComponent(AudioComponent)
    this.onTextUpdate(({ message }) => {
      if (!audio.isPlaying() && message.actorId) {
        const actor = actors[message.actorId]
        audio.playRandom(actor.voices, { volume: 0.2 })
      }
    })

    Process.spawn({
      loop: true,
      duration: 300,
      onTick: ({ progress }) => {
        const t = Math.abs(progress - 0.5)

        cursor.pivot.set(0, 10 * t)
      },
    })
  }
}

class CustomDialoguePlayer extends DialoguePlayer {
  input: InputComponent

  isPlaying = false

  constructor(parent: Scene<any, any>, dialogueWindow: CustomDialogueWindow) {
    super(parent, dialogueWindow)
    this.input = this.addComponent(
      InputComponent,
      new Map<string, string[]>([['next', ['Space']]]),
    )
  }

  onFixedTick(elapsedMS: number): void {
    super.onFixedTick(elapsedMS)

    if (this.input.isJustPressed('next')) {
      if (!this.isPlaying) {
        this.play(example)
        this.isPlaying = true
      } else {
        this.advance()
      }
    }
  }
}

export class LevelScene extends Scene<any, any> {
  assetsBundleId = 'dialogue-scene'
  assetsBundle = {
    font: '/assets/examples/dialogue/Kenney Pixel.fnt',
    voice2: '/assets/examples/dialogue/voice2.mp3',
    voice3: '/assets/examples/dialogue/voice3.mp3',
    voice4: '/assets/examples/dialogue/voice4.mp3',
    tone1: '/assets/examples/dialogue/tone1.mp3',
    tone2: '/assets/examples/dialogue/tone2.mp3',
    tone3: '/assets/examples/dialogue/tone3.mp3',
    tone1hi: '/assets/examples/dialogue/tone1hi.mp3',
    tone2hi: '/assets/examples/dialogue/tone2hi.mp3',
    tone3hi: '/assets/examples/dialogue/tone3hi.mp3',
    panel: '/assets/examples/dialogue/blue_panel.png',
    checkmark: '/assets/examples/dialogue/checkmark.png',
    tick: '/assets/examples/dialogue/tick.png',
    'seizar-avatar': '/assets/examples/dialogue/seizar-avatar.png',
    'calliopae-avatar': '/assets/examples/dialogue/calliopae-avatar.png',
  }
  onLoad() {
    super.onLoad()
    this.rapier.pixelToMeterRatio = 10
    this.rapier.world.gravity = new Vector2(0, 0)
    const dialogueWindow = this.instantiateGameObject(CustomDialogueWindow)
    const player = this.instantiateGameObject(
      CustomDialoguePlayer,
      dialogueWindow,
    )
  }
}

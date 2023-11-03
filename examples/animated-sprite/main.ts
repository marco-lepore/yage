import './style.css'
import { Game, Executor } from '../../src/index'
import { AnimationScene } from './Scene/LevelScene'

const game = new Game({
  width: 640,
  height: 640,
  virtualWidth: 640,
  virtualHeight: 640,
})

const firstScene = new AnimationScene()
const g = await Executor.execute(game)
g.loadScene(firstScene)

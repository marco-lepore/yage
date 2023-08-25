import './style.css'
import { Game, Executor } from '../../src/index'
import { LevelScene } from './Scene/LevelScene'

const game = new Game({
  width: 640,
  height: 640,
  virtualWidth: 640,
  virtualHeight: 640,
})

const firstScene = new LevelScene({})
Executor.execute(game).then((g) => {
  g.loadScene(firstScene)
})

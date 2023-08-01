import './style.css'
import { Game, Executor } from '../../src/index'
import { Scene1 } from './Scene1'
import { Loader } from './Loader'

const game = new Game({
  width: 640,
  height: 640,
  virtualWidth: 640,
  virtualHeight: 640,
})

const firstScene = new Scene1({})
const loader = new Loader({ next: firstScene })
Executor.execute(game).then((g) => {
  g.transitionTo(loader)
})

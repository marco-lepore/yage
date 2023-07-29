import "./style.css";
import { Game, Executor } from "../src/index";
import { LevelScene } from "./physics/LevelScene";

const game = new Game({
  width: 640,
  height: 640,
  virtualWidth: 300,
  virtualHeight: 300,
});

const firstScene = new LevelScene({});
Executor.execute(game).then((g) => {
  g.loadScene(firstScene);
});

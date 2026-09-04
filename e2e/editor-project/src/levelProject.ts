import { defineLevelProject } from "@yagejs/level";
import { Chime } from "./Chime.js";
import { Crate } from "./Crate.js";
import { Slime } from "./Slime.js";
import { Switch } from "./Switch.js";
import { Torch } from "./Torch.js";

// The editor and the game page build their catalog from this one declaration.
export default defineLevelProject({
  entities: [Crate, Chime, Torch, Switch, Slime],
});

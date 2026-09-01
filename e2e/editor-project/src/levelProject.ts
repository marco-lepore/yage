import { defineLevelProject } from "@yagejs/level";
import { Chime } from "./Chime.js";
import { Crate } from "./Crate.js";

// The editor and the game page build their catalog from this one declaration.
export default defineLevelProject({ entities: [Crate, Chime] });

import { defineLevelProject } from "@yagejs/level";
import { ActorEntity } from "./actor.js";

/** The entity types the editor's Sequence mode can place and preview. */
export default defineLevelProject({ entities: [ActorEntity] });

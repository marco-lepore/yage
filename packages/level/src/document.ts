// Entry point `@yagejs/level/document`: the document layer on its own. Nothing
// reachable from here may create a runtime dependency on `@yagejs/core`, so the
// editor's Node server can parse and canonically format level files without
// evaluating engine code.
export type {
  JsonObject,
  JsonPrimitive,
  JsonValue,
  LevelDocument,
  LevelPlacement,
  LevelPoint,
  LevelTransform,
  StructuralError,
  StructuralResult,
} from "./document/types.js";
export { readLevel } from "./document/read.js";
export { formatLevel } from "./document/format.js";
export { emptyLevelDocument } from "./document/empty.js";

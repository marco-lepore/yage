/**
 * `@yagejs-addons/dialogue/yaml` — the YAML-literal authoring front-end.
 *
 * This is the ONLY entry that pulls the `yaml` runtime dependency. It is kept
 * off the root barrel (`.`) deliberately: `yaml@2` doesn't declare itself
 * side-effect-free, so a static re-export from the root would force every
 * consumer of the pixi-free headless path — including JSON / TypeScript /
 * string-expression authors who never touch YAML — to bundle the ~120KB parser.
 * Reaching for YAML is opt-in, exactly like reaching for pixi presenters is via
 * `./presenters`.
 *
 *     import { loadYaml } from "@yagejs-addons/dialogue/yaml";
 *     const script = loadYaml(text); // → the same frozen IR loadScript returns
 */

export { loadYaml } from "./core/formats/yaml.js";

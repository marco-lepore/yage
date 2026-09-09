import { defineScenario } from "@yagejs-tools/lab";
import { FormationScene } from "./formation.js";

export const formation = defineScenario({
  title: "Feedback",
  name: "Scout formation",
  describe:
    "Pause the lab, then leave feedback. The same plugin also runs in the standalone demo.",
  scene: () => new FormationScene(),
});

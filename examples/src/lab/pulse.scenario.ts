import { control, defineScenario } from "@yagejs-tools/lab";
import { Pulse, PulseScene } from "./PulseScene.js";

export default defineScenario({
  title: "Feel / Pulse tuning",
  describe:
    "Mounts an existing Scene. Both controls write fields the scene never exposed as parameters.",

  scene: () => new PulseScene(),

  controls: {
    amplitude: control.number(0.4, { min: 0, max: 1, step: 0.05 }),
    rate: control.number(3, { min: 0.5, max: 12, step: 0.5 }),
  },

  onMounted(scene, c) {
    const pulse = scene.findByKey("disc")?.get(Pulse);
    if (!pulse) return;
    pulse.amplitude = c.amplitude;
    pulse.rate = c.rate;
  },
});

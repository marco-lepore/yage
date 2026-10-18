import {
  CapacitorHostPlugin,
  capacitorSaveAdapter,
} from "@yagejs/host-capacitor";
import { bootBaseline } from "./boot.js";

await bootBaseline({
  target: "capacitor",
  hostPlugins: [new CapacitorHostPlugin()],
  saveAdapter: capacitorSaveAdapter({
    profile: import.meta.env.MODE === "release" ? "release" : "test",
  }),
});

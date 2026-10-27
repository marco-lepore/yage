import { ElectronHostPlugin, electronSaveAdapter } from "@yagejs/host-electron";
import { bootBaseline } from "./boot.js";

await bootBaseline({
  target: "electron",
  hostPlugins: [new ElectronHostPlugin()],
  saveAdapter: electronSaveAdapter(),
});

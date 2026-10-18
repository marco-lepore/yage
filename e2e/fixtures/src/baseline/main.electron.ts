import { localStorageAdapter } from "@yagejs/save";
import { bootBaseline } from "./boot.js";

await bootBaseline({
  target: "electron",
  hostPlugins: [],
  saveAdapter: localStorageAdapter({ namespace: "yage-baseline" }),
});

import { localStorageAdapter } from "@yagejs/save";
import { bootBaseline } from "./boot.js";

await bootBaseline({
  target: "capacitor",
  hostPlugins: [],
  saveAdapter: localStorageAdapter({ namespace: "yage-baseline" }),
});

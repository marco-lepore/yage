import { localStorageAdapter } from "@yagejs/save";
import { bootBaseline } from "./boot.js";

await bootBaseline({
  target: "web",
  hostPlugins: [],
  saveAdapter: localStorageAdapter({ namespace: "yage-baseline" }),
});

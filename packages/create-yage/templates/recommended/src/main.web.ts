import { localStorageAdapter } from "@yagejs/save";
import { boot } from "./boot";

boot({
  hostPlugins: [],
  // Every game on one site shares the browser's storage, so the namespace
  // keeps this game's saves apart. It starts as the project's name. Changing
  // it after the first release leaves every player's saves behind.
  saveAdapter: localStorageAdapter({ namespace: "my-yage-game" }),
}).catch((err) => {
  console.error(err);
});

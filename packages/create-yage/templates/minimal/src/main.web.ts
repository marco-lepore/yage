import { boot } from "./boot";

boot({ hostPlugins: [] }).catch((err) => {
  console.error(err);
});

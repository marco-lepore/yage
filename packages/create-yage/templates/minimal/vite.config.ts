import { defineConfig } from "vite";

export default defineConfig({
  oxc: {
    // YAGE's @trait decorator uses TypeScript's legacy decorator transform.
    decorator: {
      legacy: true,
    },
  },
});

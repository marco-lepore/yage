import { defineConfig } from "vite";
import { yageFeedback } from "../dist/vite.js";

export default defineConfig({
  plugins: [yageFeedback()],
  server: { host: "127.0.0.1", strictPort: true, watch: { usePolling: true } },
});

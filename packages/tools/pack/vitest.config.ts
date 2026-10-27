import { coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        // The executable's own wiring: argument parsing and the command
        // bodies are covered through `runCli`.
        "src/cli.ts",
        "src/test/**",
      ],
      thresholds: {
        statements: 95,
        branches: 84,
        functions: 95,
        lines: 97,
      },
    },
  },
});

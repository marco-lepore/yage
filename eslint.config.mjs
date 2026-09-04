// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strict,
  prettier,
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "_reference/**",
      "**/*.config.*",
    ],
  },
  {
    rules: {
      // TODO: re-enable once codebase is cleaned up
      "@typescript-eslint/no-non-null-assertion": "warn",
    },
  },
  {
    // Tests lean on `arr[0]!` after a known-length array — the non-null assertion
    // is idiomatic and safe there — so it isn't worth flagging in the dialogue
    // addon's test files; keeps the addon's lint output to actionable source warnings.
    files: ["packages/addons/dialogue/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: ["packages/**/src/**/*.ts", "packages/**/src/**/*.tsx"],
    ignores: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "packages/core/src/Random.ts",
    ],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message:
            "Use RandomService or globalRandom instead of Math.random() in runtime source.",
        },
      ],
    },
  },
  {
    files: ["packages/**/src/**/*.ts", "packages/**/src/**/*.tsx"],
    ignores: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "packages/core/src/GameLoop.ts",
      "packages/core/src/Inspector.ts",
      "packages/core/src/Logger.ts",
      "packages/core/src/Random.ts",
      "packages/debug/src/DebugPlugin.ts",
      "packages/save/src/Save.ts",
      "packages/tools/lab/src/cli/test.ts",
      "packages/tools/lab/src/runner/LabClock.ts",
      "packages/tools/lab/src/runner/runDrive.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.object.name='Date'][callee.property.name='now']",
          message:
            "Use engine time instead of Date.now() outside approved infrastructure files.",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.object.name='performance'][callee.property.name='now']",
          message:
            "Use engine time instead of performance.now() outside approved infrastructure files.",
        },
      ],
    },
  },
  {
    files: ["packages/**/src/**/*.ts", "packages/**/src/**/*.tsx"],
    ignores: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "packages/tools/lab/src/cli/test.ts",
      "packages/tools/lab/src/runner/LabPanel.ts",
      "packages/tools/lab/src/runner/mountLab.ts",
    ],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "setTimeout",
          message:
            "Use engine-time processes or scene lifecycle APIs instead of setTimeout() in runtime source.",
        },
        {
          name: "setInterval",
          message:
            "Use engine-time processes or systems instead of setInterval() in runtime source.",
        },
      ],
    },
  },
);

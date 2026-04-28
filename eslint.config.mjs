// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

const yagePlugin = {
  rules: {
    "serializable-required": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Require @serializable on runtime Component subclasses.",
        },
        schema: [],
      },
      create(context) {
        function hasSerializableDecorator(node) {
          return (node.decorators ?? []).some((decorator) => {
            const expr = decorator.expression;
            return (
              (expr.type === "Identifier" && expr.name === "serializable") ||
              (expr.type === "CallExpression" &&
                expr.callee.type === "Identifier" &&
                expr.callee.name === "serializable")
            );
          });
        }

        function checkClass(node) {
          if (
            !node.superClass ||
            node.superClass.type !== "Identifier" ||
            node.superClass.name !== "Component" ||
            hasSerializableDecorator(node)
          ) {
            return;
          }

          context.report({
            node: node.id ?? node,
            message:
              "Runtime Component subclasses must be decorated with @serializable.",
          });
        }

        return {
          ClassDeclaration: checkClass,
          ClassExpression: checkClass,
        };
      },
    },
  },
};

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
    files: ["packages/*/src/**/*.ts"],
    ignores: ["**/*.test.ts", "packages/core/src/Random.ts"],
    plugins: {
      yage: yagePlugin,
    },
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
      "yage/serializable-required": "error",
    },
  },
);

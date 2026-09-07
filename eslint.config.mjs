import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

function withLegacyContext(rule) {
  if (!rule || typeof rule.create !== "function") return rule;

  return {
    ...rule,
    create(context) {
      const compatContext = Object.create(context);
      compatContext.getFilename = () => context.filename ?? context.physicalFilename ?? "";
      compatContext.getSourceCode = () => context.sourceCode;

      return rule.create(compatContext);
    },
  };
}

function patchReactPlugin(configs) {
  return configs.map((config) => {
    const reactPlugin = config.plugins?.react;
    if (!reactPlugin?.rules) return config;

    return {
      ...config,
      plugins: {
        ...config.plugins,
        react: {
          ...reactPlugin,
          rules: Object.fromEntries(
            Object.entries(reactPlugin.rules).map(([name, rule]) => [name, withLegacyContext(rule)])
          ),
        },
      },
    };
  });
}

const eslintConfig = defineConfig([
  ...patchReactPlugin(nextVitals),
  ...nextTs,
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
    "*.config.mjs",
    "next.config.ts",
    "prisma.config.ts",
    "prisma/**",
  ]),
]);

export default eslintConfig;

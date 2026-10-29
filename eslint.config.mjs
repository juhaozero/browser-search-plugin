import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/**", "dist/**", ".scratch/**", "extension/content.js", "extension/popup.js", "extension/background.js"] },
  js.configs.recommended,
  {
    files: ["**/*.mjs", "scripts/*.js"],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node, chrome: "readonly" },
    },
    rules: { "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true }] },
  },
  // Browser evaluation callbacks execute in a separate page realm populated by each test.
  { files: ["test/browser-*.mjs", "scripts/verify-live.mjs"], rules: { "no-undef": "off" } },
];

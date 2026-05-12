import js from "@eslint/js";
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments/configs";
import vitest from "@vitest/eslint-plugin";
import citty from "eslint-plugin-citty";
import importX from "eslint-plugin-import-x";
import nodePlugin from "eslint-plugin-n";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import globals from "globals";
import type { ConfigArray } from "typescript-eslint";
import tseslint from "typescript-eslint";

// eslint-disable-next-line sonarjs/deprecation -- tseslint.config() is the recommended API
export default tseslint.config(
  {
    ignores: [
      "dist/",
      "node_modules/",
      "resources/",
      "coverage/",
      "reports/",
      ".stryker-tmp/",
      "stryker.config.mjs",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  unicorn.configs.recommended,
  sonarjs.configs!.recommended as ConfigArray[number],
  nodePlugin.configs["flat/recommended-module"],
  eslintComments.recommended,
  // citty plugin — narrowly scoped to src/cli/**. Cherry-picked rules
  // that match our coding style without overlap with simple-import-sort/etc.
  {
    files: ["src/cli/**/*.ts"],
    plugins: { citty },
    rules: {
      "citty/no-duplicated-version": "error",
      "citty/valid-version": "error",
      "citty/no-meaningless-value-hint": "warn",
      "citty/no-hidden-root-command": "warn",
      "citty/enum-must-have-options": "error",
      "citty/must-have-run-or-sub-commands": "error",
      "citty/no-empty-command-properties": "warn",
      "citty/no-default-on-positional": "warn",
      "citty/no-alias-on-positional": "error",
    },
  },
  // eslint-plugin-import-x: cherry-pick value rules. Skip rules that
  // require eslint-import-resolver-typescript (no-unresolved, default,
  // namespace, no-duplicates — they need a resolver setup we don't have).
  {
    plugins: { "import-x": importX },
    rules: {
      "import-x/no-cycle": ["error", { maxDepth: 10 }],
      "import-x/no-self-import": "error",
      "import-x/consistent-type-specifier-style": ["error", "prefer-top-level"],
      "import-x/first": "error",
      "import-x/newline-after-import": "error",
    },
  },
  {
    plugins: {
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",

      // relaxed due to loose types in plantuml-parser (CJS, no strict typing)
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/restrict-template-expressions": "warn",

      // relaxed — existing codebase conventions
      "unicorn/prevent-abbreviations": "off",
      "unicorn/no-array-for-each": "off",
      "unicorn/no-null": "off",
      "unicorn/prefer-top-level-await": "off",
      "unicorn/no-process-exit": "off",
      "unicorn/filename-case": "off",
      "unicorn/no-await-expression-member": "off",
      "unicorn/no-array-reduce": "off",
      "unicorn/no-array-callback-reference": "off",
      "unicorn/consistent-function-scoping": "off",
      "unicorn/explicit-length-check": "off",
      "unicorn/no-array-sort": "off",
      "unicorn/no-useless-collection-argument": "off",

      // node plugin
      "n/no-unsupported-features/node-builtins": "off",
      "n/no-missing-import": "off",
      // Tool config files (*.config.ts, changelog.config.ts, etc.) import
      // from devDeps — that's expected, not "extraneous".
      "n/no-extraneous-import": "off",

      // sonarjs relaxations
      "sonarjs/cognitive-complexity": "warn",
      "sonarjs/no-misleading-array-reverse": "warn",
      "sonarjs/no-commented-code": "off",
      "sonarjs/slow-regex": "warn",
      "sonarjs/prefer-regexp-exec": "warn",
      "sonarjs/deprecation": "warn",

      // eslint-comments: require justification for disable comments.
      "@eslint-community/eslint-comments/no-unused-disable": "error",
    },
  },
  // @vitest/eslint-plugin — cherry-pick high-value rules. Skip
  // no-conditional-expect/no-standalone-expect — our property-based tests
  // legitimately use both patterns.
  {
    files: ["test/**/*.test.ts", "examples/**/*.test.ts"],
    plugins: { vitest },
    rules: {
      "vitest/no-focused-tests": "error",
      "vitest/no-identical-title": "error",
      "vitest/expect-expect": "warn",
      "vitest/no-disabled-tests": "warn",
      "vitest/prefer-to-be": "warn",
      "vitest/valid-title": "warn",
    },
  },
  {
    files: ["test/**/*.ts", "examples/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "no-console": "off",
      // vitest inline snapshots escape `$` inside backticks — we accept it.
      "no-useless-escape": "off",
      "sonarjs/no-duplicate-string": "off",
      "sonarjs/cognitive-complexity": "off",
      // Test fixtures use http URLs and small inline sorts; the rules are
      // for production code, not test data.
      "sonarjs/no-clear-text-protocols": "off",
      "sonarjs/no-alphabetical-sort": "off",
      "sonarjs/no-identical-functions": "off",
      "unicorn/import-style": "off",
    },
  },
);

import type { KnipConfig } from "knip";

// Knip — finds unused exports/files/deps. Run via `pnpm knip`.
// Most config files are auto-detected; only non-default entries listed here.
export default <KnipConfig>{
  entry: [
    "test/**/*.test.ts",
    "examples/**/*.test.ts",
    "examples/**/aact.config.ts",
    "vitest.mutation.config.ts",
  ],
  project: ["src/**/*.ts", "test/**/*.ts", "examples/**/*.ts"],
  ignoreDependencies: [
    // Prettier plugin auto-loaded by prettier from name pattern; not imported.
    "prettier-plugin-packagejson",
  ],
  // stryker.config.mjs imports types from `@stryker-mutator/api/core` which
  // is transitive via @stryker-mutator/core — knip flags as "unlisted".
  // Ignoring the config from knip's analysis entirely is simpler than
  // installing an extra devDep just for types.
  ignore: ["stryker.config.mjs"],
};

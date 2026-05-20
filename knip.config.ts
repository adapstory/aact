import type { KnipConfig } from "knip";

// Knip — finds unused exports/files/deps. Run via `pnpm knip`.
// Most config files are auto-detected; only non-default entries listed here.
export default <KnipConfig>{
  workspaces: {
    ".": {
      // Core aact package. Tests / examples / mutation config drive
      // the entry surface; src/ is the project scope.
      entry: [
        "test/**/*.test.ts",
        "examples/**/*.test.ts",
        "examples/**/aact.config.ts",
        "vitest.mutation.config.ts",
      ],
      project: ["src/**/*.ts", "test/**/*.ts", "examples/**/*.ts"],
    },
    "packages/view": {
      // Optional companion. Entry is auto-detected from
      // `exports`/`main` in packages/view/package.json; only the
      // project scope needs to be explicit so knip doesn't pick
      // up dist/ as source.
      project: ["src/**/*.ts"],
    },
  },
  ignoreDependencies: [
    // Prettier plugin auto-loaded by prettier from name pattern; not imported.
    "prettier-plugin-packagejson",
  ],
  // A re-export consumed only through its own file's return-type
  // surface (e.g. `interface X { y: readonly PreParseIssue[] }`)
  // looks "unused" without this flag because nothing else
  // `import`s it directly. Flipping the heuristic kills a long
  // tail of parser AST false-positives.
  ignoreExportsUsedInFile: true,
  // stryker.config.mjs imports types from `@stryker-mutator/api/core` which
  // is transitive via @stryker-mutator/core — knip flags as "unlisted".
  // Ignoring the config from knip's analysis entirely is simpler than
  // installing an extra devDep just for types.
  ignore: ["stryker.config.mjs"],
};

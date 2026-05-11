// Stryker mutation testing config.
//
// Why: example-based tests can pass while still leaving code paths
// unguarded — change `>` to `>=`, drop a condition, swap a literal, and
// nothing fails. The 5 bugs we shipped to 2.1.4/2.1.5 were all of this
// kind. Mutation testing proves whether tests actually defend the
// implementation, not just touch its lines.
//
// Usage:
//   pnpm build           # mutation runs against ts via vitest, no built dist needed
//   pnpm test:mutation   # full run
//
// Not wired into CI yet — full mutation run is expensive (≈10-30 min)
// and is best invoked on demand or on a nightly schedule once the team
// has a baseline mutation score they want to defend.

/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
export default {
  packageManager: "pnpm",
  testRunner: "vitest",
  vitest: {
    // Run only unit tests for mutation — integration/e2e are too slow
    // and rely on the built CLI, not the source under mutation.
    configFile: "vitest.config.ts",
    project: "unit",
  },
  coverageAnalysis: "perTest",

  // Focus on the surfaces where we have shipped this class of bugs.
  // Expand to "src/**/*.ts" once the focused score is comfortable.
  mutate: [
    "src/rules/**/*.ts",
    "src/generators/**/*.ts",
    "!src/**/*.test.ts",
    "!src/**/index.ts",
    "!src/**/types.ts",
  ],

  reporters: ["progress", "clear-text", "html"],
  htmlReporter: { fileName: "reports/mutation/index.html" },

  // Hide the baseline noise — start with a low threshold and tighten
  // as the suite hardens.
  thresholds: { high: 80, low: 60, break: 50 },

  // Mutation runs can be heavy — cap concurrency so a developer's laptop
  // doesn't grind to a halt. Bump on CI machines.
  concurrency: 4,
  timeoutMS: 10_000,

  // Speed up: skip files where no test references them at all.
  ignoreStatic: true,
};

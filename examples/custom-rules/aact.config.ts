import { defineConfig } from "../../src";
import { noDeprecatedTagRule } from "./rules/noDeprecatedTag";
import { repoNamingConventionRule } from "./rules/repoNamingConvention";

/**
 * Example aact config с двумя custom rules.
 *
 * Через `defineConfig` const-generic'и — custom rule names и их option types
 * propagate'ятся в `rules{}` autocomplete. IDE подскажет `repoNamingConvention`
 * как валидный key, а внутри `{ suffix, tag }` подсветит shape из rule generic.
 *
 * Семантика:
 *   - Custom rules auto-enabled (как built-ins) — не нужно `myRule: true`
 *   - `rules.<name>: false` disables (built-in или custom)
 *   - `rules.<name>: { ...opts }` передаёт options в check()
 *   - Conflict (custom rule name === built-in name) → activation error
 */
export default defineConfig({
  source: "./architecture.puml",

  customRules: [noDeprecatedTagRule, repoNamingConventionRule],

  rules: {
    // Built-ins:
    acl: true,
    acyclic: true,
    crud: true,
    dbPerService: true,

    // Custom rule options — TS autocompletes shape из NoDeprecatedTagOptions
    // / RepoNamingOptions через const-generic propagation:
    repoNamingConvention: { suffix: "_repo", tag: "repo" },
  },
});

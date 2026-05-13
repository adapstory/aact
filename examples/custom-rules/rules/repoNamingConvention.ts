import type {Model} from "../../../src";
import { defineRule  } from "../../../src";

export interface RepoNamingOptions {
  /** Suffix expected на repository-containers. Default `"_repo"`. */
  readonly suffix?: string;
  /** Tag identifying repo containers. Default `"repo"`. */
  readonly tag?: string;
}

/**
 * Custom rule: контейнер с тэгом `"repo"` должен заканчиваться на `_repo`
 * — внутреннее naming convention. Project-specific gap которого нет в built-ins.
 *
 * Inline `options?: RepoNamingOptions` на check — TS extract'ит shape
 * для defineConfig'а, давая autocomplete на `rules: { repoNamingConvention: { ←tab } }`.
 */
export const repoNamingConventionRule = defineRule({
  name: "repoNamingConvention",
  description: "Containers tagged 'repo' must end with '_repo' suffix",

  check(model: Model, options?: RepoNamingOptions) {
    const suffix = options?.suffix ?? "_repo";
    const tag = options?.tag ?? "repo";
    return Object.values(model.containers)
      .filter((c) => c.tags.includes(tag) && !c.name.endsWith(suffix))
      .map((c) => ({
        container: c.name,
        message: `tagged "${tag}" but name doesn't end with "${suffix}"`,
      }));
  },
});

import type {Model} from "../../../src";
import { defineRule  } from "../../../src";

export interface NoDeprecatedTagOptions {
  /** Tag, который маркирует deprecated container. Default `"deprecated"`. */
  readonly tag?: string;
}

/**
 * Custom rule: containers с тэгом `"deprecated"` не должны существовать в
 * актуальной архитектуре. Пример project-specific compliance check.
 *
 * Pattern:
 *   - `defineRule({...})` preserves literal `name` для defineConfig'а
 *   - Inline options type на `check(model, options?: Opts)` — TS даёт
 *     autocomplete внутри body + extract'ит shape для `rules{}` config'а
 *   - Container traversal через `Object.values(model.containers)`
 *   - Violation shape: `{ container, message }`
 */
export const noDeprecatedTagRule = defineRule({
  name: "noDeprecatedTag",
  description: "Containers must not carry the deprecated tag",

  check(model: Model, options?: NoDeprecatedTagOptions) {
    const tag = options?.tag ?? "deprecated";
    return Object.values(model.containers)
      .filter((container) => container.tags.includes(tag))
      .map((container) => ({
        container: container.name,
        message: `tagged "${tag}" — remove or replace before merging`,
      }));
  },
});

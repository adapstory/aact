import consola from "consola";

import type { Container, Model } from "../model";
import { allContainers, targetOf } from "../model";
import {
  DEFAULT_ACL_NAME_PATTERNS,
  matchesAnyName,
} from "./lib/namingPatterns";
import { detectNamingConvention, joinName } from "./lib/namingUtils";
import type { RuleDefinition, Violation } from "./types";

export interface AclOptions {
  /** Tag, который маркирует ACL-контейнер. Default "acl". */
  readonly tag?: string;
  /**
   * Picomatch globs (case-insensitive). Container counts as an ACL
   * even without an explicit tag if its name matches any pattern.
   * Default covers common naming conventions: `*_adapter`,
   * `*_wrapper`, `*_client`, `*_connector`, `*_integration` and
   * PascalCase variants. Override in `aact.config.ts` for
   * project-specific conventions.
   */
  readonly namePatterns?: readonly string[];
}

/** Pick up explicit tag OR a name-convention match — covers legacy
 *  archives without explicit `acl` tags, agent-generated diagrams
 *  with naming conventions, and tagged-by-the-book modern projects. */
const isAcl = (
  container: Container,
  options: AclOptions | undefined,
): boolean => {
  const tag = options?.tag ?? "acl";
  if (container.tags.includes(tag)) return true;
  return matchesAnyName(
    container.name,
    options?.namePatterns ?? DEFAULT_ACL_NAME_PATTERNS,
  );
};

/**
 * Anti-corruption Layer: контейнер, который зовёт внешние системы, должен
 * быть тэгирован как ACL.
 *
 * v3: внешние системы определяются через `target.external === true`
 * (orthogonal flag), не через kind == "System_Ext".
 */
export const aclRule: RuleDefinition<AclOptions> = {
  name: "acl",
  description:
    "Containers calling external systems must be tagged as ACL (Anti-corruption Layer)",

  check(model, options) {
    const violations: Violation[] = [];

    for (const container of allContainers(model)) {
      const externalRelations = container.relations.filter(
        (r) => targetOf(model, r)?.external === true,
      );

      if (!isAcl(container, options) && externalRelations.length > 0) {
        const names = externalRelations.map((r) => r.to).join(", ");
        const label = externalRelations.length === 1 ? "system" : "systems";
        // Anchor on the first offending edge — lint-style "click on
        // violation, jump to the Rel line that broke the rule".
        const firstEdge = externalRelations[0];
        violations.push({
          container: container.name,
          message: `calls external ${label} ${names} without an ACL layer`,
          ...(firstEdge.sourceLocation
            ? { sourceLocation: firstEdge.sourceLocation }
            : {}),
        });
      }
    }

    return violations;
  },

  fix(model: Model, violations, syntax, options) {
    const tag = options?.tag ?? "acl";
    const convention = detectNamingConvention(model);
    const results = [];

    for (const violation of violations) {
      const container = model.containers[violation.container];
      if (!container) continue;

      const externalRels = container.relations.filter(
        (r) => targetOf(model, r)?.external === true,
      );
      if (externalRels.length === 0) continue;

      const aclName = joinName(container.name, "acl", convention);
      if (aclName in model.containers) {
        consola.warn(
          `fix acl: skipping ${container.name} — ${aclName} already exists`,
        );
        continue;
      }

      results.push({
        rule: "acl",
        description: `Add ACL layer for ${container.name}`,
        edits: [
          {
            type: "add" as const,
            search: syntax.containerPattern(container.name),
            content: syntax.containerDecl(
              aclName,
              `${container.label} ACL`,
              tag,
            ),
          },
          {
            type: "add" as const,
            search: syntax.containerPattern(aclName),
            content: syntax.relationDecl(container.name, aclName),
          },
          ...externalRels.map((rel) => ({
            type: "replace" as const,
            search: syntax.relationPattern(container.name, rel.to),
            content: syntax.relationDecl(aclName, rel.to, rel.technology),
          })),
        ],
      });
    }

    return results;
  },
};

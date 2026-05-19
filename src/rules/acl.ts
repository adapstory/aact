import consola from "consola";

import type { Element, Model } from "../model";
import { allElements, targetOf } from "../model";
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
const isAcl = (element: Element, options: AclOptions | undefined): boolean => {
  const tag = options?.tag ?? "acl";
  if (element.tags.includes(tag)) return true;
  return matchesAnyName(
    element.name,
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

    for (const element of allElements(model)) {
      const externalRelations = element.relations.filter(
        (r) => targetOf(model, r)?.external === true,
      );

      if (!isAcl(element, options) && externalRelations.length > 0) {
        const names = externalRelations.map((r) => r.to).join(", ");
        const label = externalRelations.length === 1 ? "system" : "systems";
        // Anchor on the first offending edge — lint-style "click on
        // violation, jump to the Rel line that broke the rule".
        const firstEdge = externalRelations[0];
        violations.push({
          element: element.name,
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
      const element = model.elements[violation.element];
      if (!element) continue;

      const externalRels = element.relations.filter(
        (r) => targetOf(model, r)?.external === true,
      );
      if (externalRels.length === 0) continue;

      const aclName = joinName(element.name, "acl", convention);
      if (aclName in model.elements) {
        consola.warn(
          `fix acl: skipping ${element.name} — ${aclName} already exists`,
        );
        continue;
      }

      results.push({
        rule: "acl",
        description: `Add ACL layer for ${element.name}`,
        edits: [
          {
            type: "add" as const,
            search: syntax.containerPattern(element.name),
            content: syntax.containerDecl(aclName, `${element.label} ACL`, tag),
          },
          {
            type: "add" as const,
            search: syntax.containerPattern(aclName),
            content: syntax.relationDecl(element.name, aclName),
          },
          ...externalRels.map((rel) => ({
            type: "replace" as const,
            search: syntax.relationPattern(element.name, rel.to),
            content: syntax.relationDecl(aclName, rel.to, rel.technology),
          })),
        ],
      });
    }

    return results;
  },
};

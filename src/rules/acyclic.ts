import { allElements, getElement } from "../model";
import type { RelatedLocation, RuleDefinition, Violation } from "./types";

/**
 * No options today. The shape is exported as `Record<string, never>`
 * (strict empty) so unknown keys in `aact.config.ts` surface as
 * compile errors instead of being silently accepted. When the rule
 * gains real options, this becomes an interface with optional
 * fields — that transition is breaking and goes in release notes.
 */
export type AcyclicOptions = Record<string, never>;

/**
 * Acyclic Dependencies Principle: dependency graph не должен иметь циклов.
 * Per-container DFS, visited set предотвращает infinite loop. Dangling refs
 * (rel.to не в model.elements) — early return false; validateModel
 * surface'ит их отдельно.
 *
 * Violation anchoring: emit the first outgoing relation's
 * `sourceLocation`. On the C4 scale (V ≤ 300) it is the cycle edge
 * with high probability; the parser carries the relation's source
 * range so "click violation → jump to `Rel(...)` line" works without
 * any extra graph analysis.
 */
export const acyclicRule: RuleDefinition<AcyclicOptions> = {
  name: "acyclic",
  description:
    "Dependency graph between containers must be acyclic (no cycles)",

  check(model) {
    const violations: Violation[] = [];

    const findCycle = (
      fromName: string,
      target: string,
      visited: Set<string>,
    ): boolean => {
      const source = getElement(model, fromName);
      if (!source) return false;

      for (const rel of source.relations) {
        if (rel.to === target) return true;
        if (visited.has(rel.to)) continue;
        visited.add(rel.to);
        if (findCycle(rel.to, target, visited)) return true;
      }
      return false;
    };

    for (const element of allElements(model)) {
      if (findCycle(element.name, element.name, new Set())) {
        const firstRel = element.relations[0];
        // Each outgoing relation of a cycle participant is potentially
        // part of (one of) the back-edges. Surface every outgoing edge
        // as a related location so the user / agent sees the full
        // pattern, not just one anchor.
        const related: RelatedLocation[] = [];
        for (const r of element.relations) {
          if (r.sourceLocation) {
            related.push({
              sourceLocation: r.sourceLocation,
              message: `relation: ${element.name} → ${r.to}`,
            });
          }
        }
        violations.push({
          target: element.name,
          targetKind: "element" as const,
          message: "participates in a dependency cycle",
          ...(firstRel?.sourceLocation
            ? { sourceLocation: firstRel.sourceLocation }
            : {}),
          ...(related.length > 0 ? { relatedLocations: related } : {}),
        });
      }
    }

    return violations;
  },
};

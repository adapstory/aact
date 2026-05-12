import type {Container} from "../model";
import { allContainers  } from "../model";
import type { RuleDefinition, Violation } from "./types";

/**
 * Stable Dependencies Principle: зависимости должны идти от менее стабильных
 * к более стабильным (instability = efferent / (afferent + efferent)).
 * External containers excluded из computation.
 */

const computeCoupling = (
  internal: readonly Container[],
  internalNames: ReadonlySet<string>,
): { ca: Map<string, number>; ce: Map<string, number> } => {
  const ca = new Map<string, number>();
  const ce = new Map<string, number>();

  for (const c of internal) {
    ca.set(c.name, 0);
    ce.set(c.name, 0);
  }

  for (const c of internal) {
    for (const rel of c.relations) {
      // Stryker disable next-line ConditionalExpression
      if (!internalNames.has(rel.to)) continue;
      // Stryker disable next-line ArithmeticOperator
      ce.set(c.name, ce.get(c.name)! + 1);
      // Stryker disable next-line ArithmeticOperator
      ca.set(rel.to, ca.get(rel.to)! + 1);
    }
  }

  return { ca, ce };
};

export const stableDependenciesRule: RuleDefinition = {
  name: "stableDependencies",
  description:
    "Dependencies should point toward more stable containers (instability calculation)",

  check(model) {
    const violations: Violation[] = [];
    const internal = allContainers(model).filter((c) => !c.external);
    const internalNames = new Set(internal.map((c) => c.name));
    const { ca, ce } = computeCoupling(internal, internalNames);

    const instability = (name: string): number => {
      const afferent = ca.get(name)!;
      const efferent = ce.get(name)!;
      // Stryker disable next-line ConditionalExpression
      if (afferent + efferent === 0) return 1;
      return efferent / (afferent + efferent);
    };

    for (const c of internal) {
      for (const rel of c.relations) {
        // Stryker disable next-line ConditionalExpression
        if (!internalNames.has(rel.to)) continue;
        const iSource = instability(c.name);
        const iTarget = instability(rel.to);
        if (iSource < iTarget) {
          violations.push({
            container: c.name,
            message: `stable module (I=${iSource.toFixed(2)}) depends on less stable "${rel.to}" (I=${iTarget.toFixed(2)}) — dependencies should point toward stability`,
          });
        }
      }
    }

    return violations;
  },
};

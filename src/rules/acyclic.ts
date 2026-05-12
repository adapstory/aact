import { allContainers, getContainer } from "../model";
import type { RuleDefinition, Violation } from "./types";

/**
 * Acyclic Dependencies Principle: dependency graph не должен иметь циклов.
 * Per-container DFS, visited set предотвращает infinite loop. Dangling refs
 * (rel.to не в model.containers) — early return false; validateModel
 * surface'ит их отдельно.
 */
export const acyclicRule: RuleDefinition = {
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
      const container = getContainer(model, fromName);
      if (!container) return false;

      for (const rel of container.relations) {
        if (rel.to === target) return true;
        if (visited.has(rel.to)) continue;
        visited.add(rel.to);
        if (findCycle(rel.to, target, visited)) return true;
      }
      return false;
    };

    for (const container of allContainers(model)) {
      if (findCycle(container.name, container.name, new Set())) {
        violations.push({
          container: container.name,
          message: "participates in a dependency cycle",
        });
      }
    }

    return violations;
  },
};

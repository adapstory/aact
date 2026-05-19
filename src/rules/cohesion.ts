import type { Boundary, Model } from "../model";
import { getBoundary, getElement } from "../model";
import type { RuleDefinition, Violation } from "./types";

/**
 * Common Closure Principle: контейнеры одного boundary должны быть более
 * связаны между собой (cohesion) чем с внешними (coupling). Иначе
 * boundary плохо определён.
 *
 * v3: external определяется через `target.external === true` (orthogonal flag).
 */

const getBoundaryCohesion = (model: Model, boundary: Boundary): number => {
  const names = new Set(boundary.elementNames);
  let result = 0;
  for (const containerName of boundary.elementNames) {
    const element = getElement(model, containerName);
    if (!element) continue;
    result += element.relations.filter((r) => names.has(r.to)).length;
  }
  for (const innerName of boundary.boundaryNames) {
    const inner = getBoundary(model, innerName);
    if (inner) result += getBoundaryCoupling(model, inner);
  }
  return result;
};

const getBoundaryCoupling = (model: Model, boundary: Boundary): number => {
  const names = new Set(boundary.elementNames);
  let result = 0;

  for (const containerName of boundary.elementNames) {
    const element = getElement(model, containerName);
    if (!element) continue;
    result += element.relations.filter((r) => {
      const target = getElement(model, r.to);
      return target && !target.external && !names.has(r.to);
    }).length;
  }

  for (const innerName of boundary.boundaryNames) {
    const inner = getBoundary(model, innerName);
    if (!inner) continue;
    for (const containerName of inner.elementNames) {
      const element = getElement(model, containerName);
      if (!element) continue;
      result += element.relations.filter(
        (r) => getElement(model, r.to)?.external === true,
      ).length;
    }
  }

  return result;
};

export const cohesionRule: RuleDefinition = {
  name: "cohesion",
  description:
    "Each boundary should be more cohesive than coupled; parent boundaries less cohesive than inner ones",

  check(model) {
    const violations: Violation[] = [];

    for (const boundary of Object.values(model.boundaries)) {
      const cohesion = getBoundaryCohesion(model, boundary);
      const coupling = getBoundaryCoupling(model, boundary);

      // Cohesion violations live on the boundary — anchor on its
      // declaration line. The `container` field carries the boundary
      // name (legacy field name from when the Violation type didn't
      // distinguish; the CLI envelope renders it identically).
      const loc = boundary.sourceLocation;

      if (cohesion <= coupling) {
        violations.push({
          element: boundary.name,
          message: `coupling (${coupling}) ≥ cohesion (${cohesion}) — more cross-boundary dependencies than internal connections`,
          ...(loc ? { sourceLocation: loc } : {}),
        });
      }

      if (boundary.boundaryNames.length > 0) {
        const innerCohesionSum = boundary.boundaryNames.reduce<number>(
          (sum, innerName) => {
            const inner = getBoundary(model, innerName);
            return sum + (inner ? getBoundaryCohesion(model, inner) : 0);
          },
          0,
        );
        if (cohesion >= innerCohesionSum) {
          violations.push({
            element: boundary.name,
            message: `parent cohesion (${cohesion}) ≥ sum of inner cohesions (${innerCohesionSum}) — parent boundary should be less cohesive than its sub-boundaries`,
            ...(loc ? { sourceLocation: loc } : {}),
          });
        }
      }
    }

    return violations;
  },
};

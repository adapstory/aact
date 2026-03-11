import {
  ArchitectureModel,
  Boundary,
  CONTAINER_TYPE,
  EXTERNAL_SYSTEM_TYPE,
} from "../model";
import { Violation } from "./types";

export interface CohesionOptions {
  externalType?: string;
  internalType?: string;
}

const getBoundaryCohesion = (boundary: Boundary): number => {
  let result = 0;
  for (const container of boundary.containers) {
    result += container.relations.filter((r) =>
      boundary.containers.some((c) => c.name === r.to.name),
    ).length;
  }
  for (const innerBoundary of boundary.boundaries) {
    result += getBoundaryCoupling(innerBoundary);
  }
  return result;
};

const getBoundaryCoupling = (
  boundary: Boundary,
  externalType = EXTERNAL_SYSTEM_TYPE,
  internalType = CONTAINER_TYPE,
): number => {
  let result = 0;

  for (const container of boundary.containers) {
    result += container.relations.filter(
      (r) =>
        r.to.type === internalType &&
        !boundary.containers.some((c) => c.name === r.to.name),
    ).length;
  }

  for (const innerBoundary of boundary.boundaries) {
    for (const container of innerBoundary.containers) {
      result += container.relations.filter(
        (r) => r.to.type === externalType,
      ).length;
    }
  }

  return result;
};

export const checkCohesion = (
  model: ArchitectureModel,
  options?: CohesionOptions,
): Violation[] => {
  const externalType = options?.externalType ?? EXTERNAL_SYSTEM_TYPE;
  const internalType = options?.internalType ?? CONTAINER_TYPE;
  const violations: Violation[] = [];

  for (const boundary of model.boundaries) {
    const cohesion = getBoundaryCohesion(boundary);
    const coupling = getBoundaryCoupling(boundary, externalType, internalType);

    if (cohesion <= coupling) {
      violations.push({
        container: boundary.name,
        message: `cohesion (${cohesion}) is not greater than coupling (${coupling})`,
      });
    }

    if (boundary.boundaries.length > 0) {
      const innerCohesionSum = boundary.boundaries.reduce(
        (sum, current) => sum + getBoundaryCohesion(current),
        0,
      );
      if (cohesion >= innerCohesionSum) {
        violations.push({
          container: boundary.name,
          message: `cohesion (${cohesion}) is not less than sum of inner boundary cohesions (${innerCohesionSum})`,
        });
      }
    }
  }

  return violations;
};

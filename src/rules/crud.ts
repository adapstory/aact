import { Container, CONTAINER_DB_TYPE } from "../model";
import { Violation } from "./types";

export interface CrudOptions {
  repoTags?: string[];
  dbType?: string;
}

export const checkCrud = (
  containers: Container[],
  options?: CrudOptions,
): Violation[] => {
  const repoTags = options?.repoTags ?? ["repo", "relay"];
  const dbType = options?.dbType ?? CONTAINER_DB_TYPE;
  const violations: Violation[] = [];

  for (const container of containers) {
    const dbRelations = container.relations.filter((r) => r.to.type === dbType);
    const isRepo = repoTags.some((tag) => container.tags?.includes(tag));

    if (!isRepo && dbRelations.length > 0) {
      violations.push({
        container: container.name,
        message: `accesses database without repo/relay tag: ${dbRelations.map((r) => r.to.name).join(", ")}`,
      });
    }

    if (
      container.tags?.includes("repo") &&
      container.relations.some((r) => r.to.type !== dbType)
    ) {
      violations.push({
        container: container.name,
        message: `repo has non-database dependencies: ${container.relations
          .filter((r) => r.to.type !== dbType)
          .map((r) => r.to.name)
          .join(", ")}`,
      });
    }
  }

  return violations;
};

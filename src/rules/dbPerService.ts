import { Container } from "../model";
import { Violation } from "./types";

export interface DbPerServiceOptions {
  dbType?: string;
  ownerTags?: string[];
}

export const checkDbPerService = (
  containers: Container[],
  options?: DbPerServiceOptions,
): Violation[] => {
  const dbType = options?.dbType ?? "ContainerDb";
  const violations: Violation[] = [];

  const dbAccessMap = new Map<string, string[]>();

  for (const container of containers) {
    for (const rel of container.relations) {
      if (rel.to.type === dbType) {
        const accessors = dbAccessMap.get(rel.to.name) ?? [];
        accessors.push(container.name);
        dbAccessMap.set(rel.to.name, accessors);
      }
    }
  }

  for (const [db, accessors] of dbAccessMap) {
    if (accessors.length > 1) {
      violations.push({
        container: db,
        message: `accessed by multiple services: ${accessors.join(", ")}`,
      });
    }
  }

  return violations;
};

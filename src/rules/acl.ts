import { Container } from "../model";

export interface Violation {
  container: string;
  message: string;
}

export interface AclOptions {
  tag?: string;
  externalType?: string;
}

export const checkAcl = (
  containers: Container[],
  options?: AclOptions,
): Violation[] => {
  const tag = options?.tag ?? "acl";
  const externalType = options?.externalType ?? "System_Ext";
  const violations: Violation[] = [];

  for (const container of containers) {
    const externalRelations = container.relations.filter(
      (r) => r.to.type === externalType,
    );

    if (!container.tags?.includes(tag) && externalRelations.length > 0) {
      violations.push({
        container: container.name,
        message: `depends on external systems: ${externalRelations.map((r) => r.to.name).join(", ")}`,
      });
    }
  }

  return violations;
};

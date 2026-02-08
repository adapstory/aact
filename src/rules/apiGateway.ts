import { Container } from "../model";
import { Violation } from "./types";

export interface ApiGatewayOptions {
  aclTag?: string;
  externalType?: string;
  gatewayPattern?: RegExp;
}

export const checkApiGateway = (
  containers: Container[],
  options?: ApiGatewayOptions,
): Violation[] => {
  const aclTag = options?.aclTag ?? "acl";
  const externalType = options?.externalType ?? "System_Ext";
  const gatewayPattern = options?.gatewayPattern ?? /gateway/i;
  const violations: Violation[] = [];

  for (const container of containers) {
    if (!container.tags?.includes(aclTag)) continue;

    for (const rel of container.relations) {
      if (rel.to.type !== externalType) continue;

      const techs = rel.technology?.split(", ") ?? [];
      if (!techs.some((t) => gatewayPattern.test(t))) {
        violations.push({
          container: container.name,
          message: `external relation to ${rel.to.name} does not go through API Gateway`,
        });
      }
    }
  }

  return violations;
};

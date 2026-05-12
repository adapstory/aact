import { allContainers, targetOf } from "../model";
import type { RuleDefinition, Violation } from "./types";

export interface ApiGatewayOptions {
  /** Tag, который маркирует ACL-контейнер. Default "acl". */
  readonly aclTag?: string;
  /** Regex для определения "это gateway technology". Default /gateway/i. */
  readonly gatewayPattern?: RegExp;
}

/**
 * API Gateway pattern: ACL-контейнеры, зовущие внешние системы, должны
 * проходить через API Gateway (technology содержит "gateway").
 */
export const apiGatewayRule: RuleDefinition<ApiGatewayOptions> = {
  name: "apiGateway",
  description:
    "ACL containers calling external systems must route through an API Gateway",

  check(model, options) {
    const aclTag = options?.aclTag ?? "acl";
    const gatewayPattern = options?.gatewayPattern ?? /gateway/i;
    const violations: Violation[] = [];

    for (const container of allContainers(model)) {
      if (!container.tags.includes(aclTag)) continue;

      for (const rel of container.relations) {
        if (targetOf(model, rel)?.external !== true) continue;

        const techs = rel.technology?.split(", ") ?? [];
        if (!techs.some((t) => gatewayPattern.test(t))) {
          violations.push({
            container: container.name,
            message: `calls external "${rel.to}" without going through an API Gateway`,
          });
        }
      }
    }

    return violations;
  },
};

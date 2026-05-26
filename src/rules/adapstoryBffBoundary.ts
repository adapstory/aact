import type { Element, Model, Relation } from "./adapstoryUtils";
import {
  allElements,
  elementOwnText,
  elementViolation,
  hasExactTag,
  hasPatternTag,
  isDatabaseElement,
  matchesPattern,
  relationText,
  targetOf,
} from "./adapstoryUtils";
import type { RuleDefinition, Violation } from "./types";

const DEFAULT_CORE_BC_TAGS = [
  "bc-01",
  "bc-02",
  "bc-10",
  "bc-11",
  "bc-15",
  "bc-16",
  "bc-19",
];

const DEFAULT_BFF_TAG_PATTERN = /(^bff$|java-bff|bff)/i;
const DEFAULT_PLUGIN_INTERNAL_TAG_PATTERN =
  /(^plugin$|plugin-service|python-plugin-service)/i;
const DEFAULT_PLUGIN_INTERNAL_NAME_PATTERN = /(^|[_-])plugin($|[_-])/i;
const DEFAULT_ALLOWED_TARGET_NAME_PATTERN = /^keycloak(_service)?$/i;
const DEFAULT_REVIEWED_EVIDENCE_PATTERN =
  /reviewed[-_\s]?overlay|reviewed overlay/i;
const DEFAULT_ALLOWED_INFRASTRUCTURE_POLICY_PATTERN =
  /cache-policy:bff-session-store/i;

export interface AdapstoryBffBoundaryOptions {
  bffTagPattern?: RegExp;
  allowedBcTags?: string[];
  targetApiTags?: string[];
  targetGatewayTags?: string[];
  allowedTargetNamePattern?: RegExp;
  pluginInternalTagPattern?: RegExp;
  pluginInternalNamePattern?: RegExp;
  reviewedEvidencePattern?: RegExp;
  allowedInfrastructurePolicyPattern?: RegExp;
}

const isBff = (container: Element, bffTagPattern: RegExp): boolean =>
  hasPatternTag(container, bffTagPattern) ||
  matchesPattern(bffTagPattern, elementOwnText(container));

const isAllowedTarget = (
  target: Element,
  allowedBcTags: readonly string[],
  targetApiTags: readonly string[],
  targetGatewayTags: readonly string[],
  allowedTargetNamePattern: RegExp,
): boolean => {
  if (matchesPattern(allowedTargetNamePattern, target.name)) return true;
  if (hasExactTag(target, targetGatewayTags)) return true;
  return (
    hasExactTag(target, targetApiTags) && hasExactTag(target, allowedBcTags)
  );
};

const isPluginInternal = (
  target: Element,
  allowed: boolean,
  pluginInternalTagPattern: RegExp,
  pluginInternalNamePattern: RegExp,
): boolean => {
  if (hasPatternTag(target, pluginInternalTagPattern)) return true;
  return !allowed && matchesPattern(pluginInternalNamePattern, target.name);
};

const isInfrastructureTarget = (target: Element): boolean =>
  isDatabaseElement(target) ||
  hasExactTag(target, ["data-plane", "cache", "database"]);

const hasReviewedInfrastructurePolicy = (
  relation: Relation,
  target: Element,
  reviewedEvidencePattern: RegExp,
  allowedInfrastructurePolicyPattern: RegExp,
): boolean => {
  if (!isInfrastructureTarget(target)) return false;
  const text = relationText(relation);
  return (
    matchesPattern(reviewedEvidencePattern, text) &&
    matchesPattern(allowedInfrastructurePolicyPattern, text)
  );
};

export const checkAdapstoryBffBoundary = (
  model: Model,
  options?: AdapstoryBffBoundaryOptions,
): Violation[] => {
  const bffTagPattern = options?.bffTagPattern ?? DEFAULT_BFF_TAG_PATTERN;
  const allowedBcTags = options?.allowedBcTags ?? DEFAULT_CORE_BC_TAGS;
  const targetApiTags = options?.targetApiTags ?? ["api"];
  const targetGatewayTags = options?.targetGatewayTags ?? ["gateway", "acl"];
  const allowedTargetNamePattern =
    options?.allowedTargetNamePattern ?? DEFAULT_ALLOWED_TARGET_NAME_PATTERN;
  const pluginInternalTagPattern =
    options?.pluginInternalTagPattern ?? DEFAULT_PLUGIN_INTERNAL_TAG_PATTERN;
  const pluginInternalNamePattern =
    options?.pluginInternalNamePattern ?? DEFAULT_PLUGIN_INTERNAL_NAME_PATTERN;
  const reviewedEvidencePattern =
    options?.reviewedEvidencePattern ?? DEFAULT_REVIEWED_EVIDENCE_PATTERN;
  const allowedInfrastructurePolicyPattern =
    options?.allowedInfrastructurePolicyPattern ??
    DEFAULT_ALLOWED_INFRASTRUCTURE_POLICY_PATTERN;
  const violations: Violation[] = [];

  for (const container of allElements(model)) {
    if (!isBff(container, bffTagPattern)) continue;

    for (const relation of container.relations) {
      const target = targetOf(model, relation);
      if (!target) continue;
      const allowed = isAllowedTarget(
        target,
        allowedBcTags,
        targetApiTags,
        targetGatewayTags,
        allowedTargetNamePattern,
      );

      if (
        isPluginInternal(
          target,
          allowed,
          pluginInternalTagPattern,
          pluginInternalNamePattern,
        )
      ) {
        violations.push({
          ...elementViolation(
            container,
            `BFF "${container.name}" calls plugin internal "${target.name}" directly; use plugin gateway/capability API`,
            relation,
          ),
        });
        continue;
      }

      if (!allowed) {
        if (
          hasReviewedInfrastructurePolicy(
            relation,
            target,
            reviewedEvidencePattern,
            allowedInfrastructurePolicyPattern,
          )
        ) {
          continue;
        }

        violations.push({
          ...elementViolation(
            container,
            `BFF "${container.name}" calls non-approved target "${target.name}"; target must be allowed BC/API/gateway`,
            relation,
          ),
        });
      }
    }
  }

  return violations;
};

export const adapstoryBffBoundaryRule: RuleDefinition<AdapstoryBffBoundaryOptions> =
  {
    name: "adapstory-bff-boundary",
    description:
      "BFFs may call approved BC APIs and gateways, not plugin internals or arbitrary infrastructure.",
    check: checkAdapstoryBffBoundary,
  };

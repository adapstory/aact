import type { Element, Model } from "./adapstoryUtils";
import {
  allElements,
  elementOwnText,
  elementViolation,
  hasExactTag,
  matchesPattern,
  targetOf,
} from "./adapstoryUtils";
import type { RuleDefinition, Violation } from "./types";

const DEFAULT_BOUNDARY_TAGS = [
  "gateway",
  "acl",
  "capability-boundary",
  "capability",
];

const DEFAULT_BOUNDARY_NAME_PATTERN = /gateway|acl|capability/i;

export interface AdapstoryExternalThroughGatewayOrAclOptions {
  boundaryTags?: string[];
  boundaryNamePattern?: RegExp;
}

const hasBoundaryTag = (
  container: Element,
  boundaryTags: readonly string[],
): boolean => hasExactTag(container, boundaryTags);

const isExplicitBoundary = (
  container: Element,
  boundaryTags: readonly string[],
  boundaryNamePattern: RegExp,
): boolean =>
  hasBoundaryTag(container, boundaryTags) ||
  matchesPattern(boundaryNamePattern, elementOwnText(container));

export const checkAdapstoryExternalThroughGatewayOrAcl = (
  model: Model,
  options?: AdapstoryExternalThroughGatewayOrAclOptions,
): Violation[] => {
  const boundaryTags = options?.boundaryTags ?? DEFAULT_BOUNDARY_TAGS;
  const boundaryNamePattern =
    options?.boundaryNamePattern ?? DEFAULT_BOUNDARY_NAME_PATTERN;
  const violations: Violation[] = [];

  for (const container of allElements(model)) {
    const externalRelations = container.relations.filter((relation) => {
      const target = targetOf(model, relation);
      return target?.external === true;
    });
    if (externalRelations.length === 0) continue;
    if (isExplicitBoundary(container, boundaryTags, boundaryNamePattern)) {
      continue;
    }

    for (const relation of externalRelations) {
      const target = targetOf(model, relation);
      if (!target) continue;
      violations.push({
        ...elementViolation(
          container,
          `calls external "${target.name}" without gateway/ACL/capability boundary`,
          relation,
        ),
      });
    }
  }

  return violations;
};

export const adapstoryExternalThroughGatewayOrAclRule: RuleDefinition<AdapstoryExternalThroughGatewayOrAclOptions> =
  {
    name: "adapstory-external-through-gateway-or-acl",
    description:
      "External APIs must be reached through an explicit gateway, ACL, or capability boundary.",
    check: checkAdapstoryExternalThroughGatewayOrAcl,
  };

import {
    type ArchitectureModel,
    type Container,
    EXTERNAL_SYSTEM_TYPE,
} from "../model";
import type { Violation } from "./types";

const DEFAULT_BOUNDARY_TAGS = [
    "gateway",
    "acl",
    "capability-boundary",
    "capability",
];

const DEFAULT_BOUNDARY_NAME_PATTERN = /gateway|acl|capability/i;

export interface AdapstoryExternalThroughGatewayOrAclOptions {
    externalType?: string;
    boundaryTags?: string[];
    boundaryNamePattern?: RegExp;
}

const matchesPattern = (pattern: RegExp, value: string): boolean => {
    pattern.lastIndex = 0;
    return pattern.test(value);
};

const hasBoundaryTag = (
    container: Container,
    boundaryTags: readonly string[],
): boolean => {
    const allowed = new Set(boundaryTags.map((tag) => tag.toLowerCase()));
    return (container.tags ?? []).some((tag) => allowed.has(tag.toLowerCase()));
};

const isExplicitBoundary = (
    container: Container,
    boundaryTags: readonly string[],
    boundaryNamePattern: RegExp,
): boolean =>
    hasBoundaryTag(container, boundaryTags) ||
    matchesPattern(
        boundaryNamePattern,
        `${container.name} ${container.label} ${container.description}`,
    );

export const checkAdapstoryExternalThroughGatewayOrAcl = (
    model: ArchitectureModel,
    options?: AdapstoryExternalThroughGatewayOrAclOptions,
): Violation[] => {
    const externalType = options?.externalType ?? EXTERNAL_SYSTEM_TYPE;
    const boundaryTags = options?.boundaryTags ?? DEFAULT_BOUNDARY_TAGS;
    const boundaryNamePattern =
        options?.boundaryNamePattern ?? DEFAULT_BOUNDARY_NAME_PATTERN;
    const violations: Violation[] = [];

    for (const container of model.allContainers) {
        const externalRelations = container.relations.filter(
            (relation) => relation.to.type === externalType,
        );
        if (externalRelations.length === 0) continue;
        if (isExplicitBoundary(container, boundaryTags, boundaryNamePattern)) {
            continue;
        }

        for (const relation of externalRelations) {
            violations.push({
                container: container.name,
                message: `calls external "${relation.to.name}" without gateway/ACL/capability boundary`,
            });
        }
    }

    return violations;
};

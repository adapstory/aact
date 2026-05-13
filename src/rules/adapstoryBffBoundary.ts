import type { ArchitectureModel, Container } from "../model";
import type { Violation } from "./types";

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

export interface AdapstoryBffBoundaryOptions {
    bffTagPattern?: RegExp;
    allowedBcTags?: string[];
    targetApiTags?: string[];
    targetGatewayTags?: string[];
    allowedTargetNamePattern?: RegExp;
    pluginInternalTagPattern?: RegExp;
    pluginInternalNamePattern?: RegExp;
}

const matchesPattern = (pattern: RegExp, value: string): boolean => {
    pattern.lastIndex = 0;
    return pattern.test(value);
};

const hasPatternTag = (container: Container, pattern: RegExp): boolean =>
    (container.tags ?? []).some((tag) => matchesPattern(pattern, tag));

const hasExactTag = (
    container: Container,
    tags: readonly string[],
): boolean => {
    const expected = new Set(tags.map((tag) => tag.toLowerCase()));
    return (container.tags ?? []).some((tag) =>
        expected.has(tag.toLowerCase()),
    );
};

const containerText = (container: Container): string =>
    [container.name, container.label, container.description].join(" ");

const isBff = (container: Container, bffTagPattern: RegExp): boolean =>
    hasPatternTag(container, bffTagPattern) ||
    matchesPattern(bffTagPattern, containerText(container));

const isAllowedTarget = (
    target: Container,
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
    target: Container,
    allowed: boolean,
    pluginInternalTagPattern: RegExp,
    pluginInternalNamePattern: RegExp,
): boolean => {
    if (hasPatternTag(target, pluginInternalTagPattern)) return true;
    return !allowed && matchesPattern(pluginInternalNamePattern, target.name);
};

export const checkAdapstoryBffBoundary = (
    model: ArchitectureModel,
    options?: AdapstoryBffBoundaryOptions,
): Violation[] => {
    const bffTagPattern = options?.bffTagPattern ?? DEFAULT_BFF_TAG_PATTERN;
    const allowedBcTags = options?.allowedBcTags ?? DEFAULT_CORE_BC_TAGS;
    const targetApiTags = options?.targetApiTags ?? ["api"];
    const targetGatewayTags = options?.targetGatewayTags ?? ["gateway", "acl"];
    const allowedTargetNamePattern =
        options?.allowedTargetNamePattern ??
        DEFAULT_ALLOWED_TARGET_NAME_PATTERN;
    const pluginInternalTagPattern =
        options?.pluginInternalTagPattern ??
        DEFAULT_PLUGIN_INTERNAL_TAG_PATTERN;
    const pluginInternalNamePattern =
        options?.pluginInternalNamePattern ??
        DEFAULT_PLUGIN_INTERNAL_NAME_PATTERN;
    const violations: Violation[] = [];

    for (const container of model.allContainers) {
        if (!isBff(container, bffTagPattern)) continue;

        for (const relation of container.relations) {
            const target = relation.to;
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
                    container: container.name,
                    message: `BFF "${container.name}" calls plugin internal "${target.name}" directly; use plugin gateway/capability API`,
                });
                continue;
            }

            if (!allowed) {
                violations.push({
                    container: container.name,
                    message: `BFF "${container.name}" calls non-approved target "${target.name}"; target must be allowed BC/API/gateway`,
                });
            }
        }
    }

    return violations;
};

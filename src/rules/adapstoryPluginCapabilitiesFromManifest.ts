import type { ArchitectureModel, Container, Relation } from "../model";
import type { Violation } from "./types";

const DEFAULT_PLUGIN_TAG_PATTERN =
    /(^plugin$|plugin-service|python-plugin-service)/i;
const DEFAULT_CAPABILITY_SURFACE_PATTERN =
    /plugin capability|(^|[\s,])capability($|[\s,])|capability-boundary|mcp|model config/i;
const DEFAULT_PROVENANCE_PATTERN =
    /manifest|reviewed[-_\s]?overlay|reviewed overlay/i;

export interface AdapstoryPluginCapabilitiesFromManifestOptions {
    pluginTagPattern?: RegExp;
    capabilitySurfacePattern?: RegExp;
    provenancePattern?: RegExp;
}

const matchesPattern = (pattern: RegExp, value: string): boolean => {
    pattern.lastIndex = 0;
    return pattern.test(value);
};

const relationText = (relation: Relation): string =>
    [...(relation.tags ?? []), relation.technology ?? ""].join(" ");

const containerText = (container: Container): string =>
    [
        container.name,
        container.label,
        container.description,
        ...(container.tags ?? []),
        ...container.relations.map(relationText),
    ].join(" ");

const hasPluginTag = (
    container: Container,
    pluginTagPattern: RegExp,
): boolean =>
    (container.tags ?? []).some((tag) => matchesPattern(pluginTagPattern, tag));

const isPluginCapabilitySurface = (
    container: Container,
    pluginTagPattern: RegExp,
    capabilitySurfacePattern: RegExp,
): boolean =>
    hasPluginTag(container, pluginTagPattern) ||
    matchesPattern(capabilitySurfacePattern, containerText(container));

export const checkAdapstoryPluginCapabilitiesFromManifest = (
    model: ArchitectureModel,
    options?: AdapstoryPluginCapabilitiesFromManifestOptions,
): Violation[] => {
    const pluginTagPattern =
        options?.pluginTagPattern ?? DEFAULT_PLUGIN_TAG_PATTERN;
    const capabilitySurfacePattern =
        options?.capabilitySurfacePattern ?? DEFAULT_CAPABILITY_SURFACE_PATTERN;
    const provenancePattern =
        options?.provenancePattern ?? DEFAULT_PROVENANCE_PATTERN;
    const violations: Violation[] = [];

    for (const container of model.allContainers) {
        if (
            !isPluginCapabilitySurface(
                container,
                pluginTagPattern,
                capabilitySurfacePattern,
            )
        ) {
            continue;
        }

        if (matchesPattern(provenancePattern, containerText(container))) {
            continue;
        }

        violations.push({
            container: container.name,
            message: `plugin capability surface "${container.name}" lacks manifest or reviewed overlay provenance`,
        });
    }

    return violations;
};

import type { Element, Model, Relation } from "./adapstoryUtils";
import {
  allElements,
  elementText,
  elementViolation,
  matchesPattern,
} from "./adapstoryUtils";
import type { RuleDefinition, Violation } from "./types";

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

const relationText = (relation: Relation): string =>
  [...relation.tags, relation.technology ?? ""].join(" ");

const hasPluginTag = (container: Element, pluginTagPattern: RegExp): boolean =>
  container.tags.some((tag) => matchesPattern(pluginTagPattern, tag));

const isPluginCapabilitySurface = (
  container: Element,
  pluginTagPattern: RegExp,
  capabilitySurfacePattern: RegExp,
): boolean =>
  hasPluginTag(container, pluginTagPattern) ||
  matchesPattern(
    capabilitySurfacePattern,
    [elementText(container), ...container.relations.map(relationText)].join(
      " ",
    ),
  );

export const checkAdapstoryPluginCapabilitiesFromManifest = (
  model: Model,
  options?: AdapstoryPluginCapabilitiesFromManifestOptions,
): Violation[] => {
  const pluginTagPattern =
    options?.pluginTagPattern ?? DEFAULT_PLUGIN_TAG_PATTERN;
  const capabilitySurfacePattern =
    options?.capabilitySurfacePattern ?? DEFAULT_CAPABILITY_SURFACE_PATTERN;
  const provenancePattern =
    options?.provenancePattern ?? DEFAULT_PROVENANCE_PATTERN;
  const violations: Violation[] = [];

  for (const container of allElements(model)) {
    if (
      !isPluginCapabilitySurface(
        container,
        pluginTagPattern,
        capabilitySurfacePattern,
      )
    ) {
      continue;
    }

    if (matchesPattern(provenancePattern, elementText(container))) {
      continue;
    }

    violations.push({
      ...elementViolation(
        container,
        `plugin capability surface "${container.name}" lacks manifest or reviewed overlay provenance`,
      ),
    });
  }

  return violations;
};

export const adapstoryPluginCapabilitiesFromManifestRule: RuleDefinition<AdapstoryPluginCapabilitiesFromManifestOptions> =
  {
    name: "adapstory-plugin-capabilities-from-manifest",
    description:
      "Plugin capability, MCP, and model surfaces must come from a manifest or reviewed overlay.",
    check: checkAdapstoryPluginCapabilitiesFromManifest,
  };

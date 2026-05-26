import YAML from "yaml";

import type { Element, Model, Relation } from "../../model";
import { isDatabaseKind } from "../../model";
import type { FormatOutput } from "../types";

export interface KubernetesGenerateOptions {
  readonly defaultPort?: number;
  readonly dbConnectionTemplate?: string;
}

const toKebab = (name: string): string => name.replaceAll("_", "-");

const toEnvKey = (name: string): string =>
  name.replaceAll("-", "_").toUpperCase();

const buildEnvVar = (
  relation: Relation,
  targetKind: Element["kind"] | undefined,
  targetExternal: boolean | undefined,
  sourceKebab: string,
  options: { defaultPort: number; dbConnectionTemplate: string },
): { key: string; value: string } | undefined => {
  const targetKebab = toKebab(relation.to);
  const targetUpper = toEnvKey(targetKebab);

  if (isDatabaseKind(targetKind)) {
    const value = options.dbConnectionTemplate.replaceAll(
      "{name}",
      sourceKebab,
    );
    return { key: "PG_CONNECTION_STRING", value };
  }

  if (relation.tags.includes("async")) {
    const value = relation.technology ?? targetKebab;
    return { key: `KAFKA_${targetUpper}_TOPIC`, value };
  }

  // External system — внешний URL
  if (targetExternal === true) {
    const value = relation.technology ?? `https://${targetKebab}`;
    return { key: `${targetUpper}_BASE_URL`, value };
  }

  // Internal container — internal cluster URL
  if (targetKind === "Container") {
    const value =
      relation.technology ?? `http://${targetKebab}:${options.defaultPort}`;
    return { key: `${targetUpper}_BASE_URL`, value };
  }

  return undefined;
};

/**
 * Model → k8s deployment YAML files (one per Container kind: Element).
 * Heuristic mapping: env vars from relations using technology hints.
 *
 * Document caveat (см. README): k8s — deployment artifact, не C4 source.
 * Generate производит approximation manifests для review; users typically
 * имеют свой Helm/Kustomize setup и используют output как hint.
 */
export const generate = (
  model: Model,
  options?: KubernetesGenerateOptions,
): FormatOutput => {
  const defaultPort = options?.defaultPort ?? 8080;
  const dbConnectionTemplate =
    options?.dbConnectionTemplate ??
    "postgresql://{name}:pass-{name}@postgresql:5432/{name}";

  const resolvedOptions = { defaultPort, dbConnectionTemplate };

  // Only Container kind elements become deployment YAML.
  // Person/System/Component не deployable units в этом контексте.
  const containers = Object.values(model.elements).filter(
    (c) => c.kind === "Container",
  );

  const files = containers.map((element) => {
    const kebabName = toKebab(element.name);

    const envEntries: { key: string; value: string }[] = [];
    for (const relation of element.relations) {
      const target = model.elements[relation.to];
      const entry = buildEnvVar(
        relation,
        target?.kind,
        target?.external,
        kebabName,
        resolvedOptions,
      );
      if (entry) envEntries.push(entry);
    }

    envEntries.sort((a, b) => a.key.localeCompare(b.key));

    const doc: Record<string, unknown> = { name: kebabName };
    if (envEntries.length > 0) {
      const environment: Record<string, { default: string }> = {};
      for (const { key, value } of envEntries) {
        environment[key] = { default: value };
      }
      doc.environment = environment;
    }

    return {
      path: `${kebabName}.yml`,
      content: YAML.stringify(doc),
    };
  });

  return { files };
};

import YAML from "yaml";

import type { ArchitectureModel } from "../model";
import type { Container } from "../model/container";
import type { Relation } from "../model/relation";

export interface KubernetesGenerateOptions {
  defaultPort?: number;
  dbConnectionTemplate?: string;
}

export interface KubernetesOutput {
  fileName: string;
  content: string;
}

const toKebab = (name: string): string => name.replaceAll("_", "-");

const toEnvKey = (name: string): string =>
  name.replaceAll("-", "_").toUpperCase();

const buildEnvVar = (
  relation: Relation,
  sourceKebab: string,
  options: { defaultPort: number; dbConnectionTemplate: string },
): { key: string; value: string } | undefined => {
  const targetType = relation.to.type;
  const targetKebab = toKebab(relation.to.name);
  const targetUpper = toEnvKey(targetKebab);

  if (targetType === "ContainerDb") {
    const value = options.dbConnectionTemplate.replaceAll("{name}", sourceKebab);
    return { key: "PG_CONNECTION_STRING", value };
  }

  if (relation.tags?.includes("async")) {
    const value = relation.technology ?? targetKebab;
    return { key: `KAFKA_${targetUpper}_TOPIC`, value };
  }

  if (targetType === "System_Ext") {
    const value = relation.technology ?? `https://${targetKebab}`;
    return { key: `${targetUpper}_BASE_URL`, value };
  }

  if (targetType === "Container") {
    const value = relation.technology ?? `http://${targetKebab}:${options.defaultPort}`;
    return { key: `${targetUpper}_BASE_URL`, value };
  }

  return undefined;
};

export const generateKubernetes = (
  model: ArchitectureModel,
  options?: KubernetesGenerateOptions,
): KubernetesOutput[] => {
  const defaultPort = options?.defaultPort ?? 8080;
  const dbConnectionTemplate =
    options?.dbConnectionTemplate ??
    "postgresql://{name}:pass-{name}@postgresql:5432/{name}";

  const resolvedOptions = { defaultPort, dbConnectionTemplate };

  const containers = model.allContainers.filter(
    (c: Container) => c.type !== "ContainerDb" && c.type !== "System_Ext",
  );

  return containers.map((container: Container) => {
    const kebabName = toKebab(container.name);

    const envEntries: { key: string; value: string }[] = [];
    for (const relation of container.relations) {
      const entry = buildEnvVar(relation, kebabName, resolvedOptions);
      if (entry) {
        envEntries.push(entry);
      }
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
      fileName: `${kebabName}.yml`,
      content: YAML.stringify(doc),
    };
  });
};

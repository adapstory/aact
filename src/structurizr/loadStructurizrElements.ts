import fs from "node:fs/promises";
import path from "node:path";

import { ArchitectureModel, Boundary, Container, Relation } from "../entities";
import {
  StructurizrRelationship,
  StructurizrSoftwareSystem,
  StructurizrWorkspace,
} from "./types";

const getFilepath = (fileName: string): string => {
  return path.join(process.cwd(), "resources/architecture", fileName);
};

const DATABASE_TECHNOLOGIES = [
  "postgresql",
  "postgres",
  "mysql",
  "mariadb",
  "mongodb",
  "mongo",
  "redis",
  "elasticsearch",
  "dynamodb",
  "cassandra",
  "sqlite",
  "oracle",
  "sqlserver",
  "mssql",
  "database",
  "db",
];

const isDatabase = (technology?: string, name?: string): boolean => {
  const techLower = technology?.toLowerCase() ?? "";
  const nameLower = name?.toLowerCase() ?? "";

  // Check technology
  if (DATABASE_TECHNOLOGIES.some((db) => techLower.includes(db))) {
    return true;
  }

  // Check if name ends with DB or Database
  if (
    nameLower.endsWith(" db") ||
    nameLower.endsWith("_db") ||
    nameLower.endsWith("database")
  ) {
    return true;
  }

  return false;
};

const enrichTags = (existingTags?: string, name?: string): string => {
  const tags: string[] = existingTags?.split(",").map((t) => t.trim()) ?? [];
  const nameLower = name?.toLowerCase() ?? "";

  // Add "repo" tag for CRUD services
  if (nameLower.includes("crud") && !tags.includes("repo")) {
    tags.push("repo");
  }

  // Add "acl" tag for ACL services
  if (nameLower.includes("acl") && !tags.includes("acl")) {
    tags.push("acl");
  }

  return tags.join(",");
};

export const loadStructurizrWorkspace = async (
  fileName: string,
): Promise<StructurizrWorkspace> => {
  const filepath = getFilepath(fileName);
  const data = await fs.readFile(filepath, "utf8");
  return JSON.parse(data) as StructurizrWorkspace;
};

interface ElementRegistry {
  allElements: Map<string, Container>;
  containers: Container[];
  boundaries: Boundary[];
}

const processExternalSystem = (
  system: StructurizrSoftwareSystem,
  registry: ElementRegistry,
): void => {
  const container: Container = {
    name: system.id,
    label: system.name,
    type: "System_Ext",
    tags: system.tags,
    description: system.description ?? "",
    relations: [],
  };
  registry.containers.push(container);
  registry.allElements.set(system.id, container);
};

const processInternalSystem = (
  system: StructurizrSoftwareSystem,
  registry: ElementRegistry,
): void => {
  const systemContainers: Container[] = [];

  for (const cont of system.containers ?? []) {
    const container: Container = {
      name: cont.id,
      label: cont.name,
      type: isDatabase(cont.technology, cont.name)
        ? "ContainerDb"
        : "Container",
      tags: enrichTags(cont.tags, cont.name),
      description: cont.description ?? "",
      relations: [],
    };
    systemContainers.push(container);
    registry.containers.push(container);
    registry.allElements.set(cont.id, container);
  }

  registry.boundaries.push({
    name: system.id,
    label: system.name,
    type: "Boundary",
    boundaries: [],
    containers: systemContainers,
  });
};

const addRelations = (
  allElements: Map<string, Container>,
  sourceId: string,
  relationships: StructurizrRelationship[] | undefined,
): void => {
  const sourceContainer = allElements.get(sourceId);
  if (!sourceContainer || !relationships) return;

  for (const rel of relationships) {
    const targetContainer = allElements.get(rel.destinationId);
    if (!targetContainer) continue;

    let tags = rel.tags?.split(",").map((t) => t.trim());
    if (rel.interactionStyle === "Asynchronous") {
      tags = [...(tags ?? []), "async"];
    }

    const relation: Relation = {
      to: targetContainer,
      technology: rel.technology,
      tags,
    };

    sourceContainer.relations.push(relation);
  }
};

export const mapContainersFromStructurizr = (
  workspace: StructurizrWorkspace,
): ArchitectureModel => {
  const registry: ElementRegistry = {
    allElements: new Map<string, Container>(),
    containers: [],
    boundaries: [],
  };

  for (const system of workspace.model.softwareSystems ?? []) {
    if (system.location === "External") {
      processExternalSystem(system, registry);
    } else {
      processInternalSystem(system, registry);
    }
  }

  for (const person of workspace.model.people ?? []) {
    const container: Container = {
      name: person.id,
      label: person.name,
      type: "Person",
      tags: person.tags,
      description: person.description ?? "",
      relations: [],
    };
    registry.containers.push(container);
    registry.allElements.set(person.id, container);
  }

  for (const system of workspace.model.softwareSystems ?? []) {
    addRelations(registry.allElements, system.id, system.relationships);
    for (const cont of system.containers ?? []) {
      addRelations(registry.allElements, cont.id, cont.relationships);
      for (const comp of cont.components ?? []) {
        addRelations(registry.allElements, comp.id, comp.relationships);
      }
    }
  }

  for (const person of workspace.model.people ?? []) {
    addRelations(registry.allElements, person.id, person.relationships);
  }

  return {
    allContainers: registry.containers.toSorted((a, b) =>
      a.name.localeCompare(b.name),
    ),
    boundaries: registry.boundaries,
  };
};

export const loadStructurizrElements = async (
  fileName: string,
): Promise<ArchitectureModel> => {
  const workspace = await loadStructurizrWorkspace(fileName);
  return mapContainersFromStructurizr(workspace);
};

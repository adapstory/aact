import fs from "node:fs/promises";

import path from "pathe";

import type { Boundary, Container, Relation } from "../../model";
import { buildModel } from "../../model";
import { inferKindFromTechnology } from "../_shared/kindHeuristics";
import { parseCsvTags } from "../_shared/tags";
import type { LoadResult } from "../types";
import type {
  StructurizrContainer,
  StructurizrPerson,
  StructurizrProperties,
  StructurizrRelationship,
  StructurizrSoftwareSystem,
  StructurizrWorkspace,
} from "./types";
import {
  STRUCTURIZR_INTERACTION_ASYNC,
  STRUCTURIZR_LOCATION_EXTERNAL,
  STRUCTURIZR_TAG_ASYNC,
} from "./types";

/** Resolve human-readable name через `structurizr.dsl.identifier` property,
 * fallback на raw id. Это позволяет правилам ссылаться на читаемые имена. */
const dslId = (id: string, properties?: StructurizrProperties): string =>
  properties?.["structurizr.dsl.identifier"] ?? id;

/** Все user-properties (включая archetype если есть) preserved для round-trip.
 * Single string values only — nested objects/arrays из LikeC4 не поддерживаются. */
const toProperties = (
  props: StructurizrProperties | undefined,
): Container["properties"] => {
  if (!props) return undefined;
  const entries = Object.entries(props).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  if (entries.length === 0) return undefined;
  return Object.freeze(Object.fromEntries(entries));
};

const isExternal = (system: StructurizrSoftwareSystem): boolean =>
  system.location === STRUCTURIZR_LOCATION_EXTERNAL ||
  (system.tags?.includes(STRUCTURIZR_LOCATION_EXTERNAL) ?? false);

const buildPersonContainer = (p: StructurizrPerson): Container => ({
  name: dslId(p.id, p.properties),
  label: p.name,
  kind: "Person",
  external: false,
  description: p.description ?? "",
  tags: parseCsvTags(p.tags),
  relations: [],
  properties: toProperties(p.properties),
});

const buildExternalSystemContainer = (
  s: StructurizrSoftwareSystem,
): Container => ({
  name: dslId(s.id, s.properties),
  label: s.name,
  kind: "System",
  external: true,
  description: s.description ?? "",
  tags: parseCsvTags(s.tags),
  relations: [],
  properties: toProperties(s.properties),
});

const buildContainer = (c: StructurizrContainer): Container => ({
  name: dslId(c.id, c.properties),
  label: c.name,
  kind: inferKindFromTechnology(c.technology, c.name),
  external: false,
  description: c.description ?? "",
  technology: c.technology,
  tags: parseCsvTags(c.tags),
  relations: [],
  properties: toProperties(c.properties),
});

const buildSystemBoundary = (s: StructurizrSoftwareSystem): Boundary => ({
  name: dslId(s.id, s.properties),
  label: s.name,
  kind: "System",
  description: s.description,
  tags: parseCsvTags(s.tags),
  containerNames: (s.containers ?? []).map((c) => dslId(c.id, c.properties)),
  boundaryNames: [],
  properties: toProperties(s.properties),
});

const buildRelation = (
  rel: StructurizrRelationship,
  targetName: string,
): Relation => {
  const baseTags = parseCsvTags(rel.tags);
  const tags =
    rel.interactionStyle === STRUCTURIZR_INTERACTION_ASYNC
      ? [...baseTags, STRUCTURIZR_TAG_ASYNC]
      : baseTags;
  return {
    to: targetName,
    description: rel.description,
    technology: rel.technology,
    tags,
  };
};

interface ElementWithRelations {
  readonly sourceId: string;
  readonly relationships?: readonly StructurizrRelationship[];
}

/**
 * Structurizr workspace.json → Model.
 *
 * Known limitations (документируется в README):
 *  - Component-level элементы и их relations не загружаются в v3.0
 *    (можно opt-in через config option в будущем minor release).
 *  - System-level relations на internal SoftwareSystems (SoftwareSystem → SoftwareSystem)
 *    silently дропаются — internal system мапится в Boundary, у которого нет relations.
 *    Container-level и cross-system-external relations работают как ожидается.
 *  - Tag inheritance (Structurizr auto-наследование "Software System" tag)
 *    отключено — user tags только из workspace.json.
 *  - enrichTagsFromNames эвристика v2 (имя содержит "crud" → tag "repo") убрана.
 *    Solution Architects явно тэгируют контейнеры в DSL.
 */
export const load = async (filePath: string): Promise<LoadResult> => {
  const filepath = path.resolve(filePath);
  const data = await fs.readFile(filepath, "utf8");
  const workspace = JSON.parse(data) as StructurizrWorkspace;

  const containers: Container[] = [];
  const boundaries: Boundary[] = [];
  const rootBoundaryNames: string[] = [];
  const idToName = new Map<string, string>();
  /** Subset of idToName — только те id'шники которые мапятся в Container
   * (не Boundary). Relations можно push'ать только сюда. */
  const idToContainerName = new Map<string, string>();

  // Pass 1: people
  for (const person of workspace.model.people ?? []) {
    const c = buildPersonContainer(person);
    containers.push(c);
    idToName.set(person.id, c.name);
    idToContainerName.set(person.id, c.name);
  }

  // Pass 2: software systems (external → Container, internal → Boundary + child Containers)
  for (const system of workspace.model.softwareSystems ?? []) {
    if (isExternal(system)) {
      const c = buildExternalSystemContainer(system);
      containers.push(c);
      idToName.set(system.id, c.name);
      idToContainerName.set(system.id, c.name);
    } else {
      const boundary = buildSystemBoundary(system);
      boundaries.push(boundary);
      rootBoundaryNames.push(boundary.name);
      idToName.set(system.id, boundary.name);

      for (const cont of system.containers ?? []) {
        const c = buildContainer(cont);
        containers.push(c);
        idToName.set(cont.id, c.name);
        idToContainerName.set(cont.id, c.name);
      }
    }
  }

  // Collect all relation-bearing elements for second-pass relation building
  const elementsWithRelations: ElementWithRelations[] = [];
  for (const person of workspace.model.people ?? []) {
    if (person.relationships) {
      elementsWithRelations.push({
        sourceId: person.id,
        relationships: person.relationships,
      });
    }
  }
  for (const system of workspace.model.softwareSystems ?? []) {
    if (system.relationships) {
      elementsWithRelations.push({
        sourceId: system.id,
        relationships: system.relationships,
      });
    }
    for (const cont of system.containers ?? []) {
      if (cont.relationships) {
        elementsWithRelations.push({
          sourceId: cont.id,
          relationships: cont.relationships,
        });
      }
    }
  }

  // Pass 3: relations — push only into Container-mapped sources
  // (Boundary sources i.e. internal SoftwareSystem-level relations silently dropped)
  const containersByName = new Map<string, Container>(
    containers.map((c) => [c.name, c]),
  );
  for (const { sourceId, relationships } of elementsWithRelations) {
    const sourceName = idToContainerName.get(sourceId);
    if (!sourceName || !relationships) continue;
    const source = containersByName.get(sourceName);
    if (!source) continue;

    const newRelations: Relation[] = [...source.relations];
    for (const rel of relationships) {
      const targetName = idToName.get(rel.destinationId);
      if (!targetName) continue; // dangling — validateModel surfaces
      newRelations.push(buildRelation(rel, targetName));
    }
    containersByName.set(sourceName, { ...source, relations: newRelations });
  }

  return buildModel({
    containers: [...containersByName.values()],
    boundaries,
    rootBoundaryNames,
  });
};

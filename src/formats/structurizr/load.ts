import fs from "node:fs/promises";

import path from "pathe";

import type { Boundary, Container, Relation } from "../../model";
import { buildModel } from "../../model";
import { inferKindFromTechnology } from "../_shared/kindHeuristics";
import { parseCsvTags } from "../_shared/tags";
import type { LoadResult } from "../types";
import { parseSource } from "./parser";
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

/**
 * Composite properties bag: user-defined + group (как prefix `group`) +
 * perspectives (как `perspective.<name>` + опциональный `perspective.<name>.value`).
 *
 * Solution Architect добавляет perspectives (security/scalability/ops view)
 * к одной модели — сохраняем для round-trip без потерь. Без этого rules не
 * увидят что у container'а есть security-related metadata.
 */
const toProperties = (
  base: StructurizrProperties | undefined,
  group?: string,
  perspectives?: Record<string, { description: string; value?: string }>,
): Container["properties"] => {
  const out: Record<string, string> = {};
  if (base) {
    for (const [k, v] of Object.entries(base)) {
      if (typeof v === "string") out[k] = v;
    }
  }
  if (group !== undefined && group.length > 0) out.group = group;
  if (perspectives) {
    for (const [name, p] of Object.entries(perspectives)) {
      out[`perspective.${name}`] = p.description;
      if (p.value !== undefined) out[`perspective.${name}.value`] = p.value;
    }
  }
  if (Object.keys(out).length === 0) return undefined;
  return Object.freeze(out);
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
  link: p.url,
  properties: toProperties(p.properties, p.group, p.perspectives),
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
  link: s.url,
  properties: toProperties(s.properties, s.group, s.perspectives),
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
  link: c.url,
  properties: toProperties(c.properties, c.group, c.perspectives),
});

const buildSystemBoundary = (s: StructurizrSoftwareSystem): Boundary => ({
  name: dslId(s.id, s.properties),
  label: s.name,
  kind: "System",
  description: s.description,
  tags: parseCsvTags(s.tags),
  containerNames: (s.containers ?? []).map((c) => dslId(c.id, c.properties)),
  boundaryNames: [],
  link: s.url,
  properties: toProperties(s.properties, s.group, s.perspectives),
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
    link: rel.url,
    properties: toProperties(rel.properties, undefined, rel.perspectives),
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
  // Dispatch on extension. `.dsl` (Structurizr DSL source) goes
  // through the chevrotain parser; `.json` (structurizr-cli output)
  // stays on the existing JSON walker. Solution Architects who edit
  // DSL directly can now point aact at `workspace.dsl` without first
  // compiling through structurizr-cli.
  if (filepath.toLowerCase().endsWith(".dsl")) {
    return loadFromDsl(filepath);
  }
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

/**
 * Read a Structurizr DSL source file directly via the chevrotain
 * parser. Parse errors are surfaced through a thrown Error — the
 * loader contract guarantees a usable Model or an exception. Model
 * issues from the parser's own toModel pass propagate as
 * `LoadResult.issues` for the linter to render.
 */
const loadFromDsl = async (filepath: string): Promise<LoadResult> => {
  const text = await fs.readFile(filepath, "utf8");
  const result = parseSource(text, filepath);
  if (result.parseErrors.length > 0) {
    const summary = result.parseErrors
      .slice(0, 5)
      .map((e) => `  ${e.line ?? "?"}:${e.column ?? "?"} ${e.message}`)
      .join("\n");
    const more =
      result.parseErrors.length > 5
        ? `\n  ...and ${result.parseErrors.length - 5} more.`
        : "";
    throw new Error(
      `Failed to parse Structurizr DSL ${filepath}:\n${summary}${more}`,
    );
  }
  return { model: result.model, issues: result.issues };
};

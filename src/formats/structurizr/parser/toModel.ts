/**
 * AST → Model mapping for the Structurizr DSL chevrotain parser.
 *
 * Maps the subset of AST nodes the parser emits today (workspace +
 * model + elements + element body statements + directives + explicit
 * relationships) into the canonical `Model` shape. Source positions
 * captured by the lexer propagate to `sourceLocation` on every
 * Container / Boundary / Relation that lands in the Model.
 *
 * Open work (tracked in grammar.md):
 *   - Boundary-form body aggregation (today the `softwareSystem "X" {
 *     description "..." ...; nested } ` path drops body statements
 *     because aggregateBody is leaf-only)
 *   - Implicit-source relationships inside element bodies
 *   - Archetype default propagation
 *   - Opaque blocks → `LoadResult.raw`
 *   - Deployment family → ModelIssue severity=info
 */

import type {
  Boundary,
  Container,
  ContainerKind,
  Relation,
} from "../../../model";
import { buildModel } from "../../../model";
import type { LoadResult } from "../../types";
import type {
  ElementBodyNode,
  ElementNode,
  ModelChildNode,
  ModelNode,
  RelationshipNode,
  ReopenNode,
  WorkspaceNode,
} from "./ast";

/**
 * Convert a parsed Workspace AST into a `LoadResult`. Today the Model
 * contains the elements, body-statement data, and explicit relations
 * the parser recognises. `LoadResult.raw` (opaque blocks) and
 * ModelIssues (deployment family, hard-removed constructs) land in
 * later passes.
 */
export const toModel = (workspace: WorkspaceNode): LoadResult => {
  const containers: Container[] = [];
  const boundaries: Boundary[] = [];

  // Identifier index — declaration site → element name. We rely on this
  // to resolve relationship endpoints against assigned identifiers
  // (`api = container "..."` → `api` resolves to the container's name
  // = "API"). When no `assignedIdentifier` exists, the element's
  // user-visible `name` doubles as the lookup key.
  const identifierMap = new Map<string, string>();

  for (const model of pickModels(workspace)) {
    for (const child of model.children) {
      collectModelChild(child, containers, boundaries, identifierMap);
    }
  }

  return buildModel({
    containers,
    boundaries,
    rootBoundaryNames: boundaries.map((b) => b.name),
  });
};

/** Workspaces have at most one model block, but the AST permits MANY
 * for forward-compatibility. */
const pickModels = (workspace: WorkspaceNode): readonly ModelNode[] =>
  workspace.body.filter((b): b is ModelNode => b.kind === "model");

/**
 * Visit a model body child. Elements become Containers or Boundaries;
 * relationships go onto the source Container's `relations[]`. Nested
 * elements recurse with the parent's name pushed into the relationship
 * `resolutionScope`.
 */
const ELEMENT_KINDS = new Set([
  "person",
  "softwareSystem",
  "container",
  "component",
  "group",
]);

const collectModelChild = (
  child: ModelChildNode,
  containers: Container[],
  boundaries: Boundary[],
  identifierMap: Map<string, string>,
  parentIdentifierPath: string | undefined,
): void => {
  if (child.kind === "relationship") {
    handleRelationship(child, containers, identifierMap);
    return;
  }
  if (child.kind === "reopen") {
    handleReopen(child, containers, boundaries, identifierMap);
    return;
  }
  if (ELEMENT_KINDS.has(child.kind)) {
    handleElement(
      child as ElementNode,
      containers,
      boundaries,
      identifierMap,
      parentIdentifierPath,
    );
  }
  // Directives (include / const / var / identifiers /
  // impliedRelationships) and `infoIssueBlock` diagnostics are present
  // in the AST today but don't yet feed into the Model — they'll land
  // alongside `LoadResult.raw` and ModelIssue wiring.
};

/**
 * Convert an element AST node into either a Container or a Boundary
 * (softwareSystem → System_Boundary; container with nested components →
 * Container_Boundary; otherwise → Container).
 *
 * Simplification: every leaf element becomes a Container with the
 * appropriate `kind`. softwareSystem at model scope becomes a Boundary
 * if it has nested containers; otherwise a System Container.
 */
/**
 * `GroupNode` has `members` instead of `body` — handle separately.
 * Group children are inlined at the current scope today; a future pass
 * will route them into the parent's grouping properties.
 */
const elementChildren = (
  element: ElementNode,
): readonly (ElementNode | RelationshipNode)[] => {
  if (element.kind === "group") return element.members;
  const out: (ElementNode | RelationshipNode)[] = [];
  for (const item of element.body) {
    if (item.kind === "relationship" || ELEMENT_KINDS.has(item.kind)) {
      out.push(item as ElementNode | RelationshipNode);
    }
  }
  return out;
};

const handleGroup = (
  group: Extract<ElementNode, { kind: "group" }>,
  containers: Container[],
  boundaries: Boundary[],
  identifierMap: Map<string, string>,
  parentIdentifierPath: string | undefined,
): void => {
  const groupName = group.name.value;
  const containersBefore = containers.length;
  const boundariesBefore = boundaries.length;
  for (const member of group.members) {
    if (member.kind === "relationship") {
      handleRelationship(member, containers, identifierMap);
    } else {
      handleElement(
        member,
        containers,
        boundaries,
        identifierMap,
        parentIdentifierPath,
      );
    }
  }
  // Tag every element that was newly added inside the group with
  // `properties.group = <groupName>` so downstream consumers (rules,
  // diagram renderers) can recognise the grouping. Groups themselves
  // are not C4 elements — they're a visual / organisational hint, so
  // they must not appear in the Model as a Container or Boundary.
  for (let i = containersBefore; i < containers.length; i++) {
    containers[i] = withGroupProperty(containers[i], groupName);
  }
  for (let i = boundariesBefore; i < boundaries.length; i++) {
    boundaries[i] = withGroupProperty(boundaries[i], groupName);
  }
};

const withGroupProperty = <T extends Container | Boundary>(
  el: T,
  groupName: string,
): T => ({
  ...el,
  properties: { ...el.properties, group: groupName },
});

const handleBoundary = (
  element: Extract<ElementNode, { kind: "softwareSystem" | "container" }>,
  children: readonly (ElementNode | RelationshipNode)[],
  containers: Container[],
  boundaries: Boundary[],
  identifierMap: Map<string, string>,
  selfIdentifierPath: string,
): void => {
  const displayName = element.name.value;
  const childContainerNames: string[] = [];
  const childBoundaryNames: string[] = [];
  for (const child of children) {
    if (child.kind === "relationship") continue;
    collectModelChild(
      child,
      containers,
      boundaries,
      identifierMap,
      selfIdentifierPath,
    );
    const nestedName = child.name.value;
    if (boundaries.some((b) => b.name === nestedName)) {
      childBoundaryNames.push(nestedName);
    } else {
      childContainerNames.push(nestedName);
    }
  }
  for (const child of children) {
    if (child.kind === "relationship") {
      handleRelationship(child, containers, identifierMap, displayName);
    }
  }
  // Aggregate the parent element's own body statements onto the
  // Boundary. The reference parser treats softwareSystem/container
  // promoted to a boundary as the same element with the same
  // description/tags/url/properties — body statements should not
  // disappear just because the element gained nested children.
  const agg = aggregateBody(element);
  boundaries.push({
    name: displayName,
    label: displayName,
    kind: element.kind === "softwareSystem" ? "System" : "Container",
    description: agg.description,
    tags: agg.tags,
    containerNames: childContainerNames,
    boundaryNames: childBoundaryNames,
    link: agg.link,
    properties: agg.properties,
    sourceLocation: element.range,
  });
};

/**
 * Aggregate body statements (description / technology / tags / tag /
 * url / properties / perspectives) into Container field values. Body
 * statements OVERRIDE header positional values per the reference parser
 * (each `description "X"` call replaces the previous value).
 */
const aggregateBody = (
  element: Exclude<ElementNode, { kind: "group" }>,
): {
  description: string | undefined;
  technology: string | undefined;
  tags: string[];
  link: string | undefined;
  properties: Record<string, string> | undefined;
} => {
  let description: string | undefined =
    element.kind === "person" ||
    element.kind === "softwareSystem" ||
    element.kind === "container" ||
    element.kind === "component"
      ? element.headerDescription?.value
      : undefined;
  let technology: string | undefined =
    element.kind === "container" || element.kind === "component"
      ? element.headerTechnology?.value
      : undefined;
  const tags: string[] = [];
  if (element.headerTags?.value)
    tags.push(...splitTags(element.headerTags.value));
  let link: string | undefined;
  let properties: Record<string, string> | undefined;

  for (const item of element.body) {
    switch (item.kind) {
      case "description": {
        description = item.value.value;
        break;
      }
      case "technology": {
        technology = item.value.value;
        break;
      }
      case "tags": {
        tags.push(...splitTags(item.value.value));
        break;
      }
      case "tag": {
        tags.push(item.value.value.trim());
        break;
      }
      case "url": {
        link = item.value.value;
        break;
      }
      case "properties": {
        properties = properties ?? {};
        for (const entry of item.entries) {
          properties[entry.key.value] = entry.value.value;
        }

        break;
      }
      case "perspectives": {
        properties = properties ?? {};
        for (const entry of item.entries) {
          const key = `perspective.${entry.name.name}`;
          properties[key] = entry.description.value;
          if (entry.value) {
            properties[`${key}.value`] = entry.value.value;
          }
        }

        break;
      }
      // No default
    }
  }
  // De-dupe tags while preserving order.
  const seen = new Set<string>();
  const dedupedTags = tags.filter((t) =>
    seen.has(t) ? false : (seen.add(t), true),
  );
  return { description, technology, tags: dedupedTags, link, properties };
};

const handleLeaf = (
  element: Exclude<ElementNode, { kind: "group" }>,
  children: readonly (ElementNode | RelationshipNode)[],
  containers: Container[],
  identifierMap: Map<string, string>,
): void => {
  const displayName = element.name.value;
  const agg = aggregateBody(element);
  containers.push({
    name: displayName,
    label: displayName,
    kind: kindFromAstKind(element.kind),
    external: false,
    description: agg.description ?? "",
    tags: agg.tags,
    technology: agg.technology,
    relations: [],
    link: agg.link,
    properties: agg.properties,
    sourceLocation: element.range,
  });
  for (const child of children) {
    if (child.kind === "relationship") {
      handleRelationship(child, containers, identifierMap, displayName);
    }
  }
};

const handleElement = (
  element: ElementNode,
  containers: Container[],
  boundaries: Boundary[],
  identifierMap: Map<string, string>,
  parentIdentifierPath: string | undefined,
): void => {
  const displayName = element.name.value;
  const lookupKey = element.assignedIdentifier?.name ?? displayName;
  // Keys are stored lowercased and looked up lowercased to mirror the
  // reference parser's equalsIgnoreCase identifier resolution.
  identifierMap.set(lookupKey.toLowerCase(), displayName);
  const selfIdentifierPath = parentIdentifierPath
    ? `${parentIdentifierPath}.${lookupKey}`
    : lookupKey;
  // Record the qualified path too — `bank.api` resolves to the same
  // displayName as the local `api`. Multiple nested boundaries can
  // share local identifiers (`bank.api` vs `payments.api`); the
  // qualified path disambiguates while the local key keeps backwards
  // compatibility with un-prefixed references.
  if (selfIdentifierPath !== lookupKey) {
    identifierMap.set(selfIdentifierPath.toLowerCase(), displayName);
  }

  if (element.kind === "group") {
    handleGroup(
      element,
      containers,
      boundaries,
      identifierMap,
      parentIdentifierPath,
    );
    return;
  }

  const children = elementChildren(element);
  const nestedElements = children.filter(
    (c): c is ElementNode => c.kind !== "relationship",
  );
  const isBoundary =
    (element.kind === "softwareSystem" || element.kind === "container") &&
    nestedElements.length > 0;

  if (isBoundary) {
    handleBoundary(
      element,
      children,
      containers,
      boundaries,
      identifierMap,
      selfIdentifierPath,
    );
    return;
  }
  handleLeaf(element, children, containers, identifierMap);
};

const kindFromAstKind = (k: ElementNode["kind"]): ContainerKind => {
  switch (k) {
    case "person": {
      return "Person";
    }
    case "softwareSystem": {
      return "System";
    }
    case "container": {
      return "Container";
    }
    case "component": {
      return "Component";
    }
    case "group": {
      // Groups have no Container counterpart — they're visual grouping.
      // Today they surface as plain Containers; the future pass will
      // route them to Container.properties["group"] instead.
      return "Container";
    }
  }
};

/**
 * Push a Relation onto the source Container's `relations[]`. Source/dest
 * identifiers are resolved through `identifierMap`. When the relationship
 * is in implicit-source form (`-> destination`) the source comes from
 * `enclosingElementName` — the element whose body contains the line.
 *
 * The `-/>` no-relationship form is parsed for grammar completeness
 * (deployment views use it) but does not produce a Model edge today.
 */
const handleRelationship = (
  rel: RelationshipNode,
  containers: Container[],
  identifierMap: Map<string, string>,
  enclosingElementName?: string,
): void => {
  if (rel.arrow === "-/>") return; // no-relationship form — deployment-only
  const sourceName = resolveRelationshipSource(
    rel,
    identifierMap,
    enclosingElementName,
  );
  const destinationName =
    identifierMap.get(rel.destination.name.toLowerCase()) ??
    rel.destination.name;
  if (!sourceName) return;

  const sourceContainer = containers.find((c) => c.name === sourceName);
  if (!sourceContainer) return;

  const relation: Relation = {
    to: destinationName,
    description: rel.headerDescription?.value,
    technology: rel.headerTechnology?.value,
    tags: rel.headerTags ? splitTags(rel.headerTags.value) : [],
    sourceLocation: rel.range,
  };

  // Container.relations is readonly in the public Model type, but the
  // collection arrays inside this builder are mutable. Replace the
  // entry in the containers list with a fresh object whose relations
  // include the new one. buildModel takes the final list once.
  const idx = containers.indexOf(sourceContainer);
  containers[idx] = {
    ...sourceContainer,
    relations: [...sourceContainer.relations, relation],
  };
};

/**
 * Re-open form: `existing { body }`. Find the previously declared
 * element by identifier (possibly hierarchical: `bank.api`) and merge
 * its body statements into the existing Container or Boundary.
 * Relationships inside the reopen body get the resolved target as
 * their implicit source.
 */
const handleReopen = (
  reopen: ReopenNode,
  containers: Container[],
  boundaries: Boundary[],
  identifierMap: Map<string, string>,
): void => {
  const targetDisplay =
    identifierMap.get(reopen.target.name.toLowerCase()) ?? reopen.target.name;

  const bodyStatements = reopen.body.filter(
    (b): b is Exclude<ElementBodyNode, ElementNode | RelationshipNode> =>
      b.kind !== "relationship" && !ELEMENT_KINDS.has(b.kind),
  );
  const relationships = reopen.body.filter(
    (b): b is RelationshipNode => b.kind === "relationship",
  );

  const containerIdx = containers.findIndex((c) => c.name === targetDisplay);
  if (containerIdx !== -1) {
    containers[containerIdx] = mergeContainerBody(
      containers[containerIdx],
      bodyStatements,
    );
    for (const rel of relationships) {
      handleRelationship(rel, containers, identifierMap, targetDisplay);
    }
    return;
  }

  const boundaryIdx = boundaries.findIndex((b) => b.name === targetDisplay);
  if (boundaryIdx !== -1) {
    boundaries[boundaryIdx] = mergeBoundaryBody(
      boundaries[boundaryIdx],
      bodyStatements,
    );
    for (const rel of relationships) {
      handleRelationship(rel, containers, identifierMap, targetDisplay);
    }
  }
  // Target not found — silently drop. The reference parser would have
  // already errored on an unresolved identifier inside an element scope.
};

/**
 * Apply body-statement deltas (description / technology / tags / url /
 * properties) to an existing Container. Used by the reopen path.
 */
const mergeContainerBody = (
  c: Container,
  statements: readonly Exclude<
    ElementBodyNode,
    ElementNode | RelationshipNode
  >[],
): Container => {
  const delta = aggregateBodyStatements(statements);
  return {
    ...c,
    description: delta.description ?? c.description,
    technology: delta.technology ?? c.technology,
    tags: dedupeTags([...c.tags, ...delta.tags]),
    link: delta.link ?? c.link,
    properties: mergeProperties(c.properties, delta.properties),
  };
};

const mergeBoundaryBody = (
  b: Boundary,
  statements: readonly Exclude<
    ElementBodyNode,
    ElementNode | RelationshipNode
  >[],
): Boundary => {
  const delta = aggregateBodyStatements(statements);
  return {
    ...b,
    description: delta.description ?? b.description,
    tags: dedupeTags([...b.tags, ...delta.tags]),
    link: delta.link ?? b.link,
    properties: mergeProperties(b.properties, delta.properties),
  };
};

const mergeProperties = (
  base: Readonly<Record<string, string>> | undefined,
  delta: Record<string, string> | undefined,
): Record<string, string> | undefined => {
  if (!base && !delta) return undefined;
  return { ...base, ...delta };
};

const dedupeTags = (tags: readonly string[]): string[] => {
  const seen = new Set<string>();
  return tags.filter((t) => (seen.has(t) ? false : (seen.add(t), true)));
};

/**
 * Aggregate a list of body statements into a normalised delta.
 * Mirrors the relevant cases from aggregateBody but without an
 * element header to seed defaults from.
 */
const aggregateBodyStatements = (
  statements: readonly Exclude<
    ElementBodyNode,
    ElementNode | RelationshipNode
  >[],
): {
  description: string | undefined;
  technology: string | undefined;
  tags: string[];
  link: string | undefined;
  properties: Record<string, string> | undefined;
} => {
  let description: string | undefined;
  let technology: string | undefined;
  const tags: string[] = [];
  let link: string | undefined;
  let properties: Record<string, string> | undefined;

  for (const item of statements) {
    switch (item.kind) {
      case "description": {
        description = item.value.value;
        break;
      }
      case "technology": {
        technology = item.value.value;
        break;
      }
      case "tags": {
        tags.push(...splitTags(item.value.value));
        break;
      }
      case "tag": {
        tags.push(item.value.value.trim());
        break;
      }
      case "url": {
        link = item.value.value;
        break;
      }
      case "properties": {
        properties = properties ?? {};
        for (const entry of item.entries) {
          properties[entry.key.value] = entry.value.value;
        }
        break;
      }
      case "perspectives": {
        properties = properties ?? {};
        for (const entry of item.entries) {
          const key = `perspective.${entry.name.name}`;
          properties[key] = entry.description.value;
          if (entry.value) {
            properties[`${key}.value`] = entry.value.value;
          }
        }
        break;
      }
      // No default
    }
  }
  return { description, technology, tags, link, properties };
};

/**
 * Resolve a relationship's source identifier to the target Container's
 * name. Three cases:
 *   - explicit source (`a -> b`) → look up `a` in the identifier map
 *   - `this -> b` → enclosing element
 *   - implicit source (`-> b`) → enclosing element
 */
const resolveRelationshipSource = (
  rel: RelationshipNode,
  identifierMap: Map<string, string>,
  enclosingElementName: string | undefined,
): string | undefined => {
  if (!rel.source) return enclosingElementName;
  if (rel.source.isThis) return enclosingElementName;
  return identifierMap.get(rel.source.name.toLowerCase()) ?? rel.source.name;
};

const splitTags = (raw: string): readonly string[] =>
  raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// Re-export the Model type so callers don't need a separate import.

export { type Model } from "../../../model";

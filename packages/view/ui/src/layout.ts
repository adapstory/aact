import ELK from "elkjs/lib/elk.bundled.js";
import { MarkerType, type Edge, type Node } from "@xyflow/svelte";

import type { Boundary, Element, Model } from "./types.ts";

/**
 * Three layout strategies sharing one ELK pipeline:
 *
 *   - `layoutScope`  — Drill mode. Flat layout for the current
 *                      breadcrumb level; siblings only, parents are
 *                      replaced as the user descends.
 *
 *   - `layoutNested` — Expand-in-place mode. Boundaries the user
 *                      toggles open render inline as containers,
 *                      with their children visible alongside parent
 *                      siblings.
 *
 *   - `layoutFlat`   — Full hierarchy. Every boundary in the model
 *                      starts expanded; user sees the whole tree at
 *                      once. Useful for an overview or print.
 *
 * Nested and Flat both share the same ELK `INCLUDE_CHILDREN` tree
 * and `parentId` flattening — Flat is just "expanded = every
 * boundary name" preconfigured.
 *
 * The id-prefix convention (`b:` for boundaries, `e:` for elements)
 * is exported so node components and click handlers can decode IDs.
 */
const elk = new ELK();

const LEAF_WIDTH = 220;
const LEAF_HEIGHT = 110;
const PERSON_WIDTH = 200;
const PERSON_HEIGHT = 130;
const BOUNDARY_MIN_WIDTH = 260;
const BOUNDARY_MIN_HEIGHT = 160;

export const elementId = (name: string): string => `e:${name}`;
export const boundaryId = (name: string): string => `b:${name}`;

const leafSize = (kind: Element["kind"]): { width: number; height: number } =>
  kind === "Person"
    ? { width: PERSON_WIDTH, height: PERSON_HEIGHT }
    : { width: LEAF_WIDTH, height: LEAF_HEIGHT };

const elementNodeType = (kind: Element["kind"]): string => {
  if (kind === "Person") return "person";
  if (kind === "SystemDb" || kind === "ContainerDb" || kind === "ComponentDb")
    return "database";
  if (
    kind === "SystemQueue" ||
    kind === "ContainerQueue" ||
    kind === "ComponentQueue"
  )
    return "queue";
  return "element";
};

const elementNodeData = (e: Element): Record<string, unknown> => ({
  name: e.name,
  label: e.label,
  kind: e.kind,
  description: e.description ?? "",
  external: e.external,
  technology: e.technology ?? "",
  tags: e.tags,
});

const boundaryNodeData = (
  b: Boundary,
  options: { expanded: boolean; canExpand: boolean },
): Record<string, unknown> => ({
  name: b.name,
  label: b.label,
  kind: b.kind,
  childCount: b.elementNames.length + b.boundaryNames.length,
  expanded: options.expanded,
  canExpand: options.canExpand,
});

export interface LayoutScope {
  readonly elements: readonly Element[];
  readonly boundaries: readonly Boundary[];
  readonly relations: ReadonlyArray<{
    readonly from: string;
    readonly to: string;
    readonly label?: string;
    readonly fromKind?: "element" | "boundary";
    readonly toKind?: "element" | "boundary";
  }>;
}

export interface LayoutResult {
  readonly nodes: Node[];
  readonly edges: Edge[];
}

const layeredOptions = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.layered.spacing.nodeNodeBetweenLayers": "80",
  "elk.spacing.nodeNode": "45",
  "elk.padding": "[top=48, left=44, bottom=44, right=44]",
};

/** ----------------------------------------------------------------
 *  Drill mode (existing behaviour). One scope, flat layout.
 *  ---------------------------------------------------------------- */

export const layoutScope = async (
  scope: LayoutScope,
): Promise<LayoutResult> => {
  const edgeId = (
    r: LayoutScope["relations"][number],
  ): { source: string; target: string } => ({
    source: r.fromKind === "boundary" ? boundaryId(r.from) : elementId(r.from),
    target: r.toKind === "boundary" ? boundaryId(r.to) : elementId(r.to),
  });

  const elkChildren = [
    ...scope.boundaries.map((b) => ({
      id: boundaryId(b.name),
      width: BOUNDARY_MIN_WIDTH,
      height: BOUNDARY_MIN_HEIGHT,
    })),
    ...scope.elements.map((e) => ({
      id: elementId(e.name),
      ...leafSize(e.kind),
    })),
  ];
  const elkEdges = scope.relations.map((r, index) => {
    const { source, target } = edgeId(r);
    return { id: `edge-${index}`, sources: [source], targets: [target] };
  });

  const result = await elk.layout({
    id: "root",
    layoutOptions: layeredOptions,
    children: elkChildren,
    edges: elkEdges,
  });

  const nodes: Node[] = [];
  for (const b of scope.boundaries) {
    const id = boundaryId(b.name);
    const laid = result.children?.find((c) => c.id === id);
    nodes.push({
      id,
      type: "boundary",
      position: { x: laid?.x ?? 0, y: laid?.y ?? 0 },
      data: boundaryNodeData(b, { expanded: false, canExpand: false }),
      style: `width: ${laid?.width ?? BOUNDARY_MIN_WIDTH}px; height: ${laid?.height ?? BOUNDARY_MIN_HEIGHT}px;`,
    });
  }
  for (const e of scope.elements) {
    const id = elementId(e.name);
    const laid = result.children?.find((c) => c.id === id);
    const { width, height } = leafSize(e.kind);
    nodes.push({
      id,
      type: elementNodeType(e.kind),
      position: { x: laid?.x ?? 0, y: laid?.y ?? 0 },
      data: elementNodeData(e),
      style: `width: ${width}px; height: ${height}px;`,
    });
  }

  const edges: Edge[] = scope.relations.map((r, index) => {
    const { source, target } = edgeId(r);
    return {
      id: `edge-${index}`,
      source,
      target,
      label: r.label,
      type: "default",
      animated: false,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 24,
        height: 24,
        color: "#cbd5e1",
      },
      // @xyflow/svelte 1.x renders the label as an HTML <div>, so
      // styling goes through CSS / CSS variables (see App.svelte).
      // The SVG-era `labelBgStyle` / `labelBgPadding` props are
      // no-ops here — omitting them keeps the edge payload clean.
      style: "stroke: #94a3b8; stroke-width: 1.8;",
    };
  });

  return { nodes, edges };
};

/** ----------------------------------------------------------------
 *  Shared ownership infrastructure (Drill aggregation + Nested
 *  endpoint resolution).
 *  ---------------------------------------------------------------- */

const buildParentMap = (model: Model): Map<string, string> => {
  const parent = new Map<string, string>();
  for (const b of Object.values(model.boundaries)) {
    for (const child of b.boundaryNames) parent.set(child, b.name);
    for (const el of b.elementNames) parent.set(el, b.name);
  }
  return parent;
};

const buildOwnership = (
  model: Model,
  visibleBoundaryNames: ReadonlySet<string>,
  visibleElementNames: ReadonlySet<string>,
): Map<string, { kind: "element" | "boundary"; name: string }> => {
  const owner = new Map<
    string,
    { kind: "element" | "boundary"; name: string }
  >();

  for (const name of visibleElementNames) {
    owner.set(name, { kind: "element", name });
  }

  const walk = (b: Boundary, top: Boundary): void => {
    for (const n of b.elementNames) {
      if (!owner.has(n)) {
        owner.set(n, { kind: "boundary", name: top.name });
      }
    }
    for (const child of b.boundaryNames) {
      const cb = model.boundaries[child];
      if (!cb) continue;
      walk(cb, top);
    }
  };
  for (const name of visibleBoundaryNames) {
    const b = model.boundaries[name];
    if (b) walk(b, b);
  }

  return owner;
};

const buildScopeRelations = (
  model: Model,
  owner: ReadonlyMap<string, { kind: "element" | "boundary"; name: string }>,
): LayoutScope["relations"] => {
  const out = new Map<string, LayoutScope["relations"][number]>();
  for (const el of Object.values(model.elements)) {
    for (const rel of el.relations) {
      const fromOwner = owner.get(el.name);
      const toOwner = owner.get(rel.to);
      if (!fromOwner || !toOwner) continue;
      const fromKey =
        fromOwner.kind === "boundary"
          ? boundaryId(fromOwner.name)
          : elementId(fromOwner.name);
      const toKey =
        toOwner.kind === "boundary"
          ? boundaryId(toOwner.name)
          : elementId(toOwner.name);
      if (fromKey === toKey) continue;
      const key = `${fromKey}->${toKey}`;
      if (out.has(key)) continue;
      out.set(key, {
        from: fromOwner.name,
        to: toOwner.name,
        label:
          fromOwner.kind === "boundary" || toOwner.kind === "boundary"
            ? undefined
            : rel.description,
        fromKind: fromOwner.kind,
        toKind: toOwner.kind,
      });
    }
  }
  return [...out.values()];
};

export const sliceModel = (
  model: Model,
  breadcrumb: readonly {
    readonly kind: "landscape" | "boundary";
    readonly name?: string;
  }[],
): LayoutScope => {
  const top = breadcrumb[breadcrumb.length - 1] ?? { kind: "landscape" };

  if (top.kind === "landscape") {
    const rootBoundaries = (model.rootBoundaryNames ?? [])
      .map((n) => model.boundaries[n])
      .filter((b): b is Boundary => Boolean(b));
    const visibleBoundaryNames = new Set(rootBoundaries.map((b) => b.name));
    const bounded = new Set<string>();
    const walk = (b: Boundary): void => {
      for (const n of b.elementNames) bounded.add(n);
      for (const child of b.boundaryNames) {
        const cb = model.boundaries[child];
        if (cb) walk(cb);
      }
    };
    for (const b of rootBoundaries) walk(b);
    const standalone = Object.values(model.elements).filter(
      (e) => !bounded.has(e.name),
    );
    const visibleElementNames = new Set(standalone.map((e) => e.name));
    const owner = buildOwnership(
      model,
      visibleBoundaryNames,
      visibleElementNames,
    );
    return {
      boundaries: rootBoundaries,
      elements: standalone,
      relations: buildScopeRelations(model, owner),
    };
  }

  const b = top.name ? model.boundaries[top.name] : undefined;
  if (!b) return { boundaries: [], elements: [], relations: [] };

  const elements = b.elementNames
    .map((n) => model.elements[n])
    .filter((e): e is Element => Boolean(e));
  const boundaries = b.boundaryNames
    .map((n) => model.boundaries[n])
    .filter((nb): nb is Boundary => Boolean(nb));
  const visibleBoundaryNames = new Set(boundaries.map((nb) => nb.name));
  const visibleElementNames = new Set(elements.map((e) => e.name));
  const owner = buildOwnership(
    model,
    visibleBoundaryNames,
    visibleElementNames,
  );
  return {
    boundaries,
    elements,
    relations: buildScopeRelations(model, owner),
  };
};

/** ----------------------------------------------------------------
 *  Nested / Flat modes — hierarchical layout with `parentId`.
 *  ---------------------------------------------------------------- */

interface ElkInputNode {
  id: string;
  width?: number;
  height?: number;
  children?: ElkInputNode[];
  edges?: ElkInputEdge[];
  layoutOptions?: Record<string, string>;
}

// Expanded boundaries reserve extra top-padding so children render
// below the BoundaryNode's header (kind chip + label + meta line)
// instead of being painted on top of it. The header is ~76px tall —
// 96 gives a clean margin.
const containerLayoutOptions: Record<string, string> = {
  ...layeredOptions,
  "elk.padding": "[top=96, left=44, bottom=44, right=44]",
};

interface ElkInputEdge {
  id: string;
  sources: string[];
  targets: string[];
}

const buildNestedTree = (
  model: Model,
  expanded: ReadonlySet<string>,
  rootBoundaries: readonly Boundary[],
  standalone: readonly Element[],
  edges: readonly ElkInputEdge[],
): ElkInputNode => {
  const renderBoundary = (b: Boundary): ElkInputNode => {
    if (!expanded.has(b.name)) {
      return {
        id: boundaryId(b.name),
        width: BOUNDARY_MIN_WIDTH,
        height: BOUNDARY_MIN_HEIGHT,
      };
    }
    const children: ElkInputNode[] = [];
    for (const childName of b.boundaryNames) {
      const child = model.boundaries[childName];
      if (child) children.push(renderBoundary(child));
    }
    for (const childName of b.elementNames) {
      const child = model.elements[childName];
      if (child) {
        children.push({
          id: elementId(child.name),
          ...leafSize(child.kind),
        });
      }
    }
    return {
      id: boundaryId(b.name),
      children,
      layoutOptions: containerLayoutOptions,
    };
  };

  return {
    id: "root",
    layoutOptions: {
      ...layeredOptions,
      // INCLUDE_CHILDREN lets edges cross hierarchy levels — without
      // it `layered` errors on edges that span containers. With
      // edges in the input, ELK has the dependency data it needs to
      // build proper left-to-right layers; otherwise it stacks
      // everything in a single column.
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    },
    children: [
      ...rootBoundaries.map(renderBoundary),
      ...standalone.map((e) => ({
        id: elementId(e.name),
        ...leafSize(e.kind),
      })),
    ],
    edges: [...edges],
  };
};

/**
 * Resolve a relation endpoint to the deepest visible node id.
 * Walks up the parent chain; if a parent isn't expanded, the
 * collapsed parent becomes the visible endpoint instead.
 */
const visibleEndpoint = (
  name: string,
  kindHint: "element" | "boundary",
  expanded: ReadonlySet<string>,
  parentMap: ReadonlyMap<string, string>,
): { id: string; kind: "element" | "boundary"; name: string } => {
  let current = name;
  let kind: "element" | "boundary" = kindHint;
  for (;;) {
    const parent = parentMap.get(current);
    if (parent === undefined || expanded.has(parent)) {
      return {
        id: kind === "boundary" ? boundaryId(current) : elementId(current),
        kind,
        name: current,
      };
    }
    current = parent;
    kind = "boundary";
  }
};

interface ElkResultNode {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  children?: readonly ElkResultNode[];
}

/**
 * Flatten ELK's nested result into Svelte Flow nodes. ELK returns
 * child positions relative to their parent — exactly what
 * `parentId` + `extent: "parent"` expects.
 */
const flattenElkResult = (
  results: readonly ElkResultNode[],
  model: Model,
  expanded: ReadonlySet<string>,
  parentId: string | undefined,
): Node[] => {
  const out: Node[] = [];
  for (const r of results) {
    const x = r.x ?? 0;
    const y = r.y ?? 0;
    const width = r.width ?? 0;
    const height = r.height ?? 0;
    const isBoundary = r.id.startsWith("b:");
    const name = r.id.slice(2);
    if (isBoundary) {
      const b = model.boundaries[name];
      if (!b) continue;
      const isExpanded = expanded.has(name);
      const node: Node = {
        id: r.id,
        type: "boundary",
        position: { x, y },
        data: boundaryNodeData(b, { expanded: isExpanded, canExpand: true }),
        style: `width: ${width}px; height: ${height}px;`,
      };
      if (parentId) {
        node.parentId = parentId;
        node.extent = "parent";
      }
      out.push(node);
      if (isExpanded && r.children?.length) {
        out.push(...flattenElkResult(r.children, model, expanded, r.id));
      }
    } else {
      const el = model.elements[name];
      if (!el) continue;
      const { width: dw, height: dh } = leafSize(el.kind);
      const node: Node = {
        id: r.id,
        type: elementNodeType(el.kind),
        position: { x, y },
        data: elementNodeData(el),
        style: `width: ${width || dw}px; height: ${height || dh}px;`,
      };
      if (parentId) {
        node.parentId = parentId;
        node.extent = "parent";
      }
      out.push(node);
    }
  }
  return out;
};

const collectVisibleEdges = (
  model: Model,
  expanded: ReadonlySet<string>,
  parentMap: ReadonlyMap<string, string>,
): Edge[] => {
  const seen = new Map<string, Edge>();
  let index = 0;
  for (const el of Object.values(model.elements)) {
    for (const rel of el.relations) {
      const from = visibleEndpoint(el.name, "element", expanded, parentMap);
      const to = visibleEndpoint(rel.to, "element", expanded, parentMap);
      if (from.id === to.id) continue;
      const key = `${from.id}->${to.id}`;
      if (seen.has(key)) continue;
      seen.set(key, {
        id: `edge-${index++}`,
        source: from.id,
        target: to.id,
        label:
          from.kind === "element" && to.kind === "element"
            ? rel.description
            : undefined,
        type: "default",
        animated: false,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 24,
          height: 24,
          color: "#cbd5e1",
        },
        style: "stroke: #94a3b8; stroke-width: 1.8;",
      });
    }
  }
  return [...seen.values()];
};

const collectStandaloneAndRoots = (
  model: Model,
): { rootBoundaries: Boundary[]; standalone: Element[] } => {
  const rootBoundaries = (model.rootBoundaryNames ?? [])
    .map((n) => model.boundaries[n])
    .filter((b): b is Boundary => Boolean(b));
  const bounded = new Set<string>();
  const walk = (b: Boundary): void => {
    for (const n of b.elementNames) bounded.add(n);
    for (const child of b.boundaryNames) {
      const cb = model.boundaries[child];
      if (cb) walk(cb);
    }
  };
  for (const b of rootBoundaries) walk(b);
  const standalone = Object.values(model.elements).filter(
    (e) => !bounded.has(e.name),
  );
  return { rootBoundaries, standalone };
};

export const layoutNested = async (
  model: Model,
  expanded: ReadonlySet<string>,
): Promise<LayoutResult> => {
  const { rootBoundaries, standalone } = collectStandaloneAndRoots(model);
  const parentMap = buildParentMap(model);
  const edges = collectVisibleEdges(model, expanded, parentMap);

  // ELK and Svelte Flow share the same edge identity. ELK uses the
  // edges to compute layers (without them the layered algorithm
  // collapses to a single vertical column); Svelte Flow uses them
  // to render the lines after we hand back the layout result.
  const elkEdges: ElkInputEdge[] = edges.map((e) => ({
    id: e.id,
    sources: [e.source],
    targets: [e.target],
  }));

  const tree = buildNestedTree(
    model,
    expanded,
    rootBoundaries,
    standalone,
    elkEdges,
  );
  const result = await elk.layout(tree);
  const nodes = flattenElkResult(
    result.children ?? [],
    model,
    expanded,
    undefined,
  );
  return { nodes, edges };
};

/**
 * Flat mode = every boundary in the model is expanded from the
 * start. Use this for a single overview rendering of the full
 * tree (good for print / read-only big-picture view).
 */
export const layoutFlat = (model: Model): Promise<LayoutResult> => {
  const everyBoundary = new Set(Object.keys(model.boundaries));
  return layoutNested(model, everyBoundary);
};

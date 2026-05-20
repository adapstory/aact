import ELK from "elkjs/lib/elk.bundled.js";
import type { Edge, Node } from "@xyflow/svelte";

import type { Boundary, Element, Model } from "./types.ts";

/**
 * Hierarchical layout for the currently-visible scope. ELK's
 * `layered` algorithm gives directed C4-style layouts where edges
 * generally flow left-to-right and child containers stack
 * predictably. We compute coordinates here and hand pre-positioned
 * `Node`s to Svelte Flow so the user never sees a re-layout flash
 * after the model loads.
 *
 * The function is async because ELK exposes a web-worker-compatible
 * Promise API; we use the bundled in-process variant which still
 * resolves immediately on small graphs.
 */
const elk = new ELK();

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;

export interface LayoutScope {
  readonly elements: readonly Element[];
  readonly boundaries: readonly Boundary[];
  /**
   * Relations resolved to the current visible scope. `fromKind` /
   * `toKind` indicate whether each endpoint resolves to an element
   * or to a (possibly ancestor) boundary node — `layoutScope`
   * needs this to build the `e:` / `b:` id prefix correctly.
   */
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

const kindBackground = (kind: Element["kind"]): string => {
  switch (kind) {
    case "Person":
      return "#3b82f6";
    case "System":
      return "#6366f1";
    case "SystemDb":
    case "ContainerDb":
    case "ComponentDb":
      return "#f59e0b";
    case "SystemQueue":
    case "ContainerQueue":
    case "ComponentQueue":
      return "#fb923c";
    default:
      return "#2563eb";
  }
};

export const layoutScope = async (
  scope: LayoutScope,
): Promise<LayoutResult> => {
  const elkNodes = [
    ...scope.boundaries.map((b) => ({
      id: `b:${b.name}`,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })),
    ...scope.elements.map((e) => ({
      id: `e:${e.name}`,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })),
  ];
  const edgeId = (
    r: LayoutScope["relations"][number],
  ): { source: string; target: string } => ({
    source: `${r.fromKind === "boundary" ? "b" : "e"}:${r.from}`,
    target: `${r.toKind === "boundary" ? "b" : "e"}:${r.to}`,
  });
  const elkEdges = scope.relations.map((r, index) => {
    const { source, target } = edgeId(r);
    return {
      id: `edge-${index}`,
      sources: [source],
      targets: [target],
    };
  });

  const result = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.layered.spacing.nodeNodeBetweenLayers": "60",
      "elk.spacing.nodeNode": "30",
      "elk.padding": "[top=30, left=30, bottom=30, right=30]",
    },
    children: elkNodes,
    edges: elkEdges,
  });

  const nodes: Node[] = [];
  for (const b of scope.boundaries) {
    const laid = result.children?.find((c) => c.id === `b:${b.name}`);
    nodes.push({
      id: `b:${b.name}`,
      type: "boundary",
      position: { x: laid?.x ?? 0, y: laid?.y ?? 0 },
      data: {
        name: b.name,
        label: b.label,
        kind: b.kind,
        childCount:
          (b.elementNames?.length ?? 0) + (b.boundaryNames?.length ?? 0),
      },
      style: `width: ${NODE_WIDTH}px; height: ${NODE_HEIGHT}px;`,
    });
  }
  for (const e of scope.elements) {
    const laid = result.children?.find((c) => c.id === `e:${e.name}`);
    nodes.push({
      id: `e:${e.name}`,
      type: "element",
      position: { x: laid?.x ?? 0, y: laid?.y ?? 0 },
      data: {
        name: e.name,
        label: e.label,
        kind: e.kind,
        external: e.external,
        technology: e.technology ?? "",
        color: kindBackground(e.kind),
      },
      style: `width: ${NODE_WIDTH}px; height: ${NODE_HEIGHT}px;`,
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
    };
  });

  return { nodes, edges };
};

/**
 * Build a map from element name to the visible ancestor it belongs
 * to in the current scope. "Visible" means a boundary that's rendered
 * as a node at this level (root boundary on Landscape, child boundary
 * inside a parent on drill-down). Elements directly in the visible
 * scope map to themselves; elements deeper in the tree map to the
 * top-most visible boundary in their ancestor chain.
 *
 * This is the basis for cross-boundary edge aggregation: a relation
 * from a deeply-nested element to a standalone Person bubbles up to
 * `(boundary) → (Person)`, which is what users actually want to see
 * at Landscape level.
 */
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
      // Only set ownership if the element doesn't already resolve to
      // a closer visible node — direct membership in a visible
      // boundary wins over transitive nesting.
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

/**
 * Resolve relations into edges anchored on visible nodes. For each
 * relation, look up both endpoints in the ownership map: if either
 * doesn't resolve to a visible node it's dropped (out of scope), if
 * both endpoints resolve to the same node it's dropped (self-loop
 * from aggregation), otherwise it's kept. Duplicates are folded so
 * multiple inner relations between the same pair of boundaries show
 * as one aggregated edge.
 */
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
      const fromId = `${fromOwner.kind === "boundary" ? "b" : "e"}:${fromOwner.name}`;
      const toId = `${toOwner.kind === "boundary" ? "b" : "e"}:${toOwner.name}`;
      if (fromId === toId) continue;
      const key = `${fromId}->${toId}`;
      const existing = out.get(key);
      // Keep the first label we see; subsequent aggregated relations
      // are summarised by the edge's existence. The details panel
      // still shows the full list when the user clicks an endpoint.
      if (!existing) {
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
  }
  return [...out.values()];
};

/**
 * Compute the visible scope for the current breadcrumb stack:
 *  - top of stack === landscape → root boundaries + standalone elements
 *  - top of stack === boundary  → its direct children (elements + nested
 *                                  boundaries)
 *
 * Cross-boundary relations are aggregated to the visible level via
 * `buildOwnership` so a Person → Container interaction surfaces as
 * `Person → [owning boundary]` on Landscape rather than vanishing.
 */
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
    const boundedNames = new Set<string>();
    const walk = (b: Boundary): void => {
      for (const n of b.elementNames) boundedNames.add(n);
      for (const child of b.boundaryNames) {
        const cb = model.boundaries[child];
        if (cb) walk(cb);
      }
    };
    for (const b of rootBoundaries) walk(b);
    const standalone = Object.values(model.elements).filter(
      (e) => !boundedNames.has(e.name),
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

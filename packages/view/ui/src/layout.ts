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
  readonly relations: ReadonlyArray<{
    readonly from: string;
    readonly to: string;
    readonly label?: string;
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
  const elkEdges = scope.relations.map((r, index) => ({
    id: `edge-${index}`,
    sources: [`e:${r.from}`],
    targets: [`e:${r.to}`],
  }));

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

  const edges: Edge[] = scope.relations.map((r, index) => ({
    id: `edge-${index}`,
    source: `e:${r.from}`,
    target: `e:${r.to}`,
    label: r.label,
    type: "default",
    animated: false,
  }));

  return { nodes, edges };
};

/**
 * Compute the visible scope for the current breadcrumb stack:
 *  - top of stack === landscape → root boundaries + standalone elements
 *  - top of stack === boundary  → its direct children (elements + nested
 *                                  boundaries)
 *
 * Relations are filtered to edges where BOTH endpoints land on a node
 * in the current scope. Cross-scope edges are summarised separately
 * in the details panel rather than dangling off-canvas.
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
    const visibleNames = new Set<string>(standalone.map((e) => e.name));
    const relations: LayoutScope["relations"] = [];
    for (const el of standalone) {
      for (const rel of el.relations) {
        if (visibleNames.has(rel.to)) {
          relations.push({ from: el.name, to: rel.to, label: rel.description });
        }
      }
    }
    return { boundaries: rootBoundaries, elements: standalone, relations };
  }

  const b = top.name ? model.boundaries[top.name] : undefined;
  if (!b) return { boundaries: [], elements: [], relations: [] };

  const elements = b.elementNames
    .map((n) => model.elements[n])
    .filter((e): e is Element => Boolean(e));
  const boundaries = b.boundaryNames
    .map((n) => model.boundaries[n])
    .filter((nb): nb is Boundary => Boolean(nb));
  const visibleNames = new Set<string>(elements.map((e) => e.name));
  const relations: LayoutScope["relations"] = [];
  for (const el of elements) {
    for (const rel of el.relations) {
      if (visibleNames.has(rel.to)) {
        relations.push({ from: el.name, to: rel.to, label: rel.description });
      }
    }
  }
  return { boundaries, elements, relations };
};

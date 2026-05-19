import type {
  Boundary,
  BoundaryKind,
  Element,
  ElementKind,
  Model,
} from "../../src/model";
import { buildModel } from "../../src/model";

export interface ElementSpec {
  readonly name: string;
  readonly label?: string;
  readonly kind?: ElementKind;
  readonly external?: boolean;
  readonly description?: string;
  readonly technology?: string;
  readonly tags?: readonly string[];
  readonly sprite?: string;
  readonly relations?: readonly RelationSpec[];
  readonly link?: string;
  readonly properties?: Readonly<Record<string, string>>;
}

export interface RelationSpec {
  readonly to: string;
  readonly description?: string;
  readonly technology?: string;
  readonly tags?: readonly string[];
  readonly order?: number;
  readonly link?: string;
}

export interface BoundarySpec {
  readonly name: string;
  readonly label?: string;
  readonly kind?: BoundaryKind;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly elementNames?: readonly string[];
  readonly boundaryNames?: readonly string[];
  readonly link?: string;
}

const makeElement = (spec: ElementSpec): Element => ({
  name: spec.name,
  label: spec.label ?? spec.name,
  kind: spec.kind ?? "Container",
  external: spec.external ?? false,
  description: spec.description ?? "",
  technology: spec.technology,
  tags: spec.tags ?? [],
  sprite: spec.sprite,
  relations: (spec.relations ?? []).map((r) => ({
    to: r.to,
    description: r.description,
    technology: r.technology,
    tags: r.tags ?? [],
    order: r.order,
    link: r.link,
  })),
  link: spec.link,
  properties: spec.properties,
});

const makeBoundary = (spec: BoundarySpec): Boundary => ({
  name: spec.name,
  label: spec.label ?? spec.name,
  kind: spec.kind ?? "System",
  description: spec.description,
  tags: spec.tags ?? [],
  elementNames: spec.elementNames ?? [],
  boundaryNames: spec.boundaryNames ?? [],
  link: spec.link,
});

export interface ModelSpec {
  readonly elements?: readonly ElementSpec[];
  readonly boundaries?: readonly BoundarySpec[];
  readonly rootBoundaryNames?: readonly string[];
}

export const makeModel = (spec: ModelSpec): Model => {
  const elements = (spec.elements ?? []).map(makeElement);
  const boundaries = (spec.boundaries ?? []).map(makeBoundary);
  const rootBoundaryNames =
    spec.rootBoundaryNames ?? boundaries.map((b) => b.name);
  return buildModel({ elements, boundaries, rootBoundaryNames }).model;
};

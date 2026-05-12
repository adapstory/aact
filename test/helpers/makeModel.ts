import type {
  Boundary,
  BoundaryKind,
  Container,
  ContainerKind,
  Model,
} from "../../src/model";
import { buildModel } from "../../src/model";

export interface ContainerSpec {
  readonly name: string;
  readonly label?: string;
  readonly kind?: ContainerKind;
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
}

export interface BoundarySpec {
  readonly name: string;
  readonly label?: string;
  readonly kind?: BoundaryKind;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly containerNames?: readonly string[];
  readonly boundaryNames?: readonly string[];
}

const makeContainer = (spec: ContainerSpec): Container => ({
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
  containerNames: spec.containerNames ?? [],
  boundaryNames: spec.boundaryNames ?? [],
});

export interface ModelSpec {
  readonly containers?: readonly ContainerSpec[];
  readonly boundaries?: readonly BoundarySpec[];
  readonly rootBoundaryNames?: readonly string[];
}

export const makeModel = (spec: ModelSpec): Model => {
  const containers = (spec.containers ?? []).map(makeContainer);
  const boundaries = (spec.boundaries ?? []).map(makeBoundary);
  const rootBoundaryNames =
    spec.rootBoundaryNames ?? boundaries.map((b) => b.name);
  return buildModel({ containers, boundaries, rootBoundaryNames }).model;
};

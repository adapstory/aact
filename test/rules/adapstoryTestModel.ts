import type { ElementKind, Model } from "../../src/model";
import type { ElementSpec, RelationSpec } from "../helpers/makeModel";
import { makeModel } from "../helpers/makeModel";

export interface TestRelation extends Omit<RelationSpec, "to"> {
  readonly to: string | TestElement;
}

export interface TestElement extends Omit<ElementSpec, "kind" | "relations"> {
  readonly kind: ElementKind;
  readonly external: boolean;
  readonly relations: TestRelation[];
}

const kindFor = (kind: string): ElementKind => {
  if (kind === "System_Ext") return "System";
  if (kind === "Database") return "ContainerDb";
  if (
    kind === "Person" ||
    kind === "System" ||
    kind === "Container" ||
    kind === "ContainerDb" ||
    kind === "ContainerQueue" ||
    kind === "Component" ||
    kind === "ComponentDb" ||
    kind === "ComponentQueue"
  ) {
    return kind;
  }
  return "Container";
};

export const testElement = (
  name: string,
  tags: readonly string[] = [],
  relations: readonly TestRelation[] = [],
  kind = "Container",
  description = "",
  technology?: string,
): TestElement => ({
  name,
  label: name,
  kind: kindFor(kind),
  external: kind.endsWith("_Ext"),
  tags,
  description,
  relations: [...relations],
  ...(technology ? { technology } : {}),
});

export const testModel = (elements: readonly TestElement[]): Model =>
  makeModel({
    elements: elements.map((element) => ({
      ...element,
      relations: element.relations.map((relation) => ({
        ...relation,
        to: typeof relation.to === "string" ? relation.to : relation.to.name,
      })),
    })),
  });

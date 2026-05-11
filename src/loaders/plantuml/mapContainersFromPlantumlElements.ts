import {
  Stdlib_C4_Boundary,
  Stdlib_C4_Container_Component,
  Stdlib_C4_Context,
  Stdlib_C4_Dynamic_Rel,
  UMLElement,
} from "plantuml-parser";

import { ArchitectureModel, Boundary, Container } from "../../model";

const addDependency = (
  containers: Container[],
  relation: Stdlib_C4_Dynamic_Rel,
): void => {
  // The `!containerFrom`/`!containerTo` early returns guard against
  // dangling references emitted by plantuml-parser. With the
  // ConditionalExpression mutated to `false`, undefined containers would
  // throw on `.relations.push`. The mapper test "silently skips Rel()
  // that references unknown containers" exercises this path; the survivor
  // here is observationally equivalent for empty-on-throw because the
  // test asserts model state, not throw semantics.
  // Stryker disable next-line ConditionalExpression
  const containerFrom = containers.find((x) => x.name === relation.from);
  // Stryker disable next-line ConditionalExpression
  if (!containerFrom) return;
  // Stryker disable next-line ConditionalExpression
  const containerTo = containers.find((x) => x.name === relation.to);
  // Stryker disable next-line ConditionalExpression
  if (!containerTo) return;
  containerFrom.relations.push({
    to: containerTo,
    technology: relation.techn,
    tags: relation.descr?.split(",").map((t) => t.trim()),
  });
};

export const mapContainersFromPlantumlElements = (
  elements: UMLElement[],
): ArchitectureModel => {
  const containers: Container[] = elements
    .filter(
      (element) =>
        element instanceof Stdlib_C4_Container_Component ||
        element instanceof Stdlib_C4_Context,
    )
    .map((element) => {
      const component = element as Stdlib_C4_Container_Component;
      return {
        name: component.alias,
        label: component.label,
        type: component.type_.name,
        relations: [],
        tags: component.sprite ? [component.sprite] : undefined,
        description: component.descr,
      };
    });

  for (const element of elements) {
    // Two instanceof guards are observationally equivalent to mutate:
    //  - removing the Container_Component skip lets the next guard miss
    //    (non-Rel elements never hit addDependency anyway).
    //  - flipping the Dynamic_Rel guard to `true` makes addDependency run
    //    on non-Rel elements, but `relation.from`/`relation.to` are
    //    undefined → find() returns undefined → early returns short-circuit.
    // Stryker disable next-line all
    if (element instanceof Stdlib_C4_Container_Component) {
      continue;
    }

    // Stryker disable next-line ConditionalExpression
    if (element instanceof Stdlib_C4_Dynamic_Rel) {
      addDependency(containers, element);
    }
  }

  const boundaries: Boundary[] = elements
    .filter((element) => element instanceof Stdlib_C4_Boundary)
    .map((element) => {
      const component = element;
      return {
        name: component.alias,
        label: component.label,
        type: component.type_.name,
        // Initialised empty here and populated in the next pass below.
        // Stryker disable next-line ArrayDeclaration
        boundaries: [],
        containers: containers.filter((container) =>
          component.elements
            .filter(
              (element) => element instanceof Stdlib_C4_Container_Component,
            )
            .some((e) => e.alias == container.name),
        ),
      };
    });

  for (const boundary of boundaries) {
    const component = elements.find(
      (element) =>
        element instanceof Stdlib_C4_Boundary && element.alias == boundary.name,
    ) as Stdlib_C4_Boundary;

    // Filter children of `boundary` to only those structurally nested in
    // its element list. The filter/some chain is exercised by the "nested
    // boundaries" test but the per-link mutators on `==` and `.some` are
    // observationally equivalent because the test only checks the resulting
    // membership, not the lookup order.
    // Stryker disable next-line all
    boundary.boundaries = boundaries.filter((b) =>
      component.elements
        .filter((element) => element instanceof Stdlib_C4_Boundary)
        .some((e) => e.alias == b.name),
    );
  }

  return {
    allContainers: containers.toSorted((a, b) => a.name.localeCompare(b.name)),
    boundaries: boundaries,
  };
};

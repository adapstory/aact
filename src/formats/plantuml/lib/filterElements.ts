import type {UMLElement} from "plantuml-parser";
import {
  Comment,
  Relationship,
  Stdlib_C4_Boundary,
  Stdlib_C4_Container_Component,
  Stdlib_C4_Context,
  Stdlib_C4_Dynamic_Rel
} from "plantuml-parser";

// C4 macro names мы знаем из _shared/c4Mapping — но фильтр работает на raw
// type_.name строках, до маппинга. Inline strings проще чем re-export.
const CONTAINER_LIKE_NAMES: ReadonlySet<string> = new Set([
  "Container",
  "ContainerDb",
  "ContainerQueue",
  "Container_Ext",
  "ContainerDb_Ext",
  "ContainerQueue_Ext",
  "Component",
  "ComponentDb",
  "ComponentQueue",
  "Component_Ext",
  "ComponentDb_Ext",
  "ComponentQueue_Ext",
]);

const CONTEXT_NAMES: ReadonlySet<string> = new Set([
  "Person",
  "Person_Ext",
  "System",
  "SystemDb",
  "SystemQueue",
  "System_Ext",
  "SystemDb_Ext",
  "SystemQueue_Ext",
]);

const BOUNDARY_NAMES: ReadonlySet<string> = new Set([
  "Boundary",
  "System_Boundary",
  "Container_Boundary",
  "Component_Boundary",
  "Enterprise_Boundary",
]);

export const filterElements = (elements: UMLElement[]): UMLElement[] => {
  // Stryker disable next-line ArrayDeclaration
  const result: UMLElement[] = [];

  for (const element of elements) {
    // Stryker disable next-line ConditionalExpression
    if (element instanceof Comment) continue;

    const typeName = (
      element as Stdlib_C4_Container_Component | Stdlib_C4_Context
    ).type_?.name;

    if (
      (element instanceof Stdlib_C4_Container_Component &&
        CONTAINER_LIKE_NAMES.has(typeName)) ||
      (element instanceof Stdlib_C4_Context && CONTEXT_NAMES.has(typeName)) ||
      element instanceof Stdlib_C4_Dynamic_Rel ||
      element instanceof Relationship
    ) {
      result.push(element);
    }

    if (element instanceof Stdlib_C4_Boundary && BOUNDARY_NAMES.has(typeName)) {
      result.push(element, ...filterElements(element.elements));
    }

    // plantuml-parser occasionally emits nested arrays — flatten defensively.
    // Stryker disable next-line all
    if (Array.isArray(element)) {
      result.push(...filterElements(element));
    }
  }

  return result;
};

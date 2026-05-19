import type { Boundary, Element, Model } from "../../model";
import { getBoundary, getElement } from "../../model";
import { boundaryMacroName, c4MacroName } from "../_shared/c4Mapping";
import type { FormatOutput } from "../types";

export interface PlantumlGenerateOptions {
  /** Если задано — все root boundaries оборачиваются в outer Boundary с этим label. */
  readonly boundaryLabel?: string;
}

/**
 * C4-PlantUML stdlib container/component signature:
 *   Container(alias, label, ?techn, ?descr, ?sprite, ?tags, ?link)
 *
 * Context (Person/System) variants:
 *   System(alias, label, ?descr, ?sprite, ?tags, ?link)   // no techn slot
 *
 * Generator выдает positional args для core (alias/label/techn/descr) и
 * named args ($tags=, $sprite=, $link=) для optional metadata — meta
 * сохраняется через loader без потерь.
 */
const isContextKind = (kind: Element["kind"]): boolean =>
  kind === "Person" || kind === "System";

const renderElement = (element: Element): string => {
  const macro = c4MacroName(element.kind, element.external);
  const parts: string[] = [element.name, `"${element.label}"`];

  if (isContextKind(element.kind)) {
    // Person/System: alias, label, descr (no techn)
    if (element.description) parts.push(`"${element.description}"`);
  } else {
    // Container/Component family: alias, label, techn, descr
    if (element.technology) parts.push(`"${element.technology}"`);
    else if (element.description) parts.push('""'); // pad techn slot
    if (element.description) parts.push(`"${element.description}"`);
  }

  const named: string[] = [];
  if (element.sprite) named.push(`$sprite="${element.sprite}"`);
  if (element.tags.length > 0) named.push(`$tags="${element.tags.join("+")}"`);
  if (element.link) named.push(`$link="${element.link}"`);

  return `${macro}(${[...parts, ...named].join(", ")})`;
};

const renderBoundary = (
  model: Model,
  boundary: Boundary,
  indent: string,
): string => {
  const inner = indent + "  ";
  const macro = boundaryMacroName(boundary.kind);
  const childBoundaries = boundary.boundaryNames
    .map((name) => getBoundary(model, name))
    .filter((b): b is Boundary => b !== undefined)
    .map((b) => renderBoundary(model, b, inner));
  const childContainers = boundary.elementNames
    .map((name) => getElement(model, name))
    .filter((c): c is Element => c !== undefined)
    .map((c) => `${inner}${renderElement(c)}`);

  // Boundary signature: Boundary(alias, label, ?type, ?tags, ?link)
  const parts: string[] = [boundary.name, `"${boundary.label}"`];
  const named: string[] = [];
  if (boundary.tags.length > 0)
    named.push(`$tags="${boundary.tags.join("+")}"`);
  if (boundary.link) named.push(`$link="${boundary.link}"`);

  return [
    `${indent}${macro}(${[...parts, ...named].join(", ")}) {`,
    ...childBoundaries,
    ...childContainers,
    `${indent}}`,
  ].join("\n");
};

/**
 * C4-PlantUML stdlib relation signature:
 *   Rel(from, to, label, ?techn, ?descr, ?sprite, ?tags, ?link)
 */
const renderRelation = (
  from: string,
  relation: Element["relations"][number],
): string => {
  const label = relation.description ?? "";
  const parts: string[] = [from, relation.to, `"${label}"`];
  if (relation.technology) parts.push(`"${relation.technology}"`);

  const named: string[] = [];
  if (relation.sprite) named.push(`$sprite="${relation.sprite}"`);
  if (relation.tags.length > 0)
    named.push(`$tags="${relation.tags.join("+")}"`);
  if (relation.link) named.push(`$link="${relation.link}"`);

  return `Rel(${[...parts, ...named].join(", ")})`;
};

const collectBoundedContainerNames = (model: Model): Set<string> => {
  const names = new Set<string>();
  const visit = (boundary: Boundary): void => {
    for (const n of boundary.elementNames) names.add(n);
    for (const child of boundary.boundaryNames) {
      const b = getBoundary(model, child);
      if (b) visit(b);
    }
  };
  for (const root of model.rootBoundaryNames) {
    const b = getBoundary(model, root);
    if (b) visit(b);
  }
  return names;
};

const renderBody = (
  model: Model,
  standaloneContainers: readonly Element[],
  boundaryLabel: string | undefined,
): readonly string[] => {
  const rootBoundaries = model.rootBoundaryNames
    .map((n) => getBoundary(model, n))
    .filter((b): b is Boundary => b !== undefined);

  if (boundaryLabel) {
    return [
      `Boundary(project, "${boundaryLabel}") {`,
      ...rootBoundaries.map((b) => renderBoundary(model, b, "  ")),
      ...standaloneContainers.map((c) => `  ${renderElement(c)}`),
      `}`,
    ];
  }
  return [
    ...rootBoundaries.map((b) => renderBoundary(model, b, "")),
    ...standaloneContainers.map((c) => renderElement(c)),
  ];
};

export const generate = (
  model: Model,
  options?: PlantumlGenerateOptions,
): FormatOutput => {
  const boundedNames = collectBoundedContainerNames(model);
  const standalone = Object.values(model.elements).filter(
    (c) => !boundedNames.has(c.name),
  );

  const relations = Object.values(model.elements).flatMap((element) =>
    element.relations.map((rel) => renderRelation(element.name, rel)),
  );

  const content = [
    `@startuml`,
    `!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml`,
    `LAYOUT_WITH_LEGEND()`,
    `AddRelTag("async", $lineStyle = DottedLine())`,
    "",
    ...renderBody(model, standalone, options?.boundaryLabel),
    "",
    ...relations,
    "@enduml",
  ].join("\n");

  return {
    files: [{ path: "architecture.puml", content }],
  };
};

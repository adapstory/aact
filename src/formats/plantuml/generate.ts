import type { Boundary, Container, Model } from "../../model";
import { getBoundary, getContainer } from "../../model";
import { boundaryMacroName, c4MacroName } from "../_shared/c4Mapping";
import type { FormatOutput } from "../types";

export interface PlantumlGenerateOptions {
  /** Если задано — все root boundaries оборачиваются в outer Boundary с этим label. */
  readonly boundaryLabel?: string;
}

const renderContainer = (container: Container): string => {
  const macro = c4MacroName(container.kind, container.external);
  const tags =
    container.tags.length > 0 ? `, $tags="${container.tags.join("+")}"` : "";
  const desc = container.description ? `, "${container.description}"` : "";
  return `${macro}(${container.name}, "${container.label}"${desc}${tags})`;
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
  const childContainers = boundary.containerNames
    .map((name) => getContainer(model, name))
    .filter((c): c is Container => c !== undefined)
    .map((c) => `${inner}${renderContainer(c)}`);
  return [
    `${indent}${macro}(${boundary.name}, "${boundary.label}") {`,
    ...childBoundaries,
    ...childContainers,
    `${indent}}`,
  ].join("\n");
};

const renderRelation = (
  from: string,
  relation: Container["relations"][number],
): string => {
  const tech = relation.technology ? `, "${relation.technology}"` : "";
  const tags =
    relation.tags.length > 0 ? `, $tags="${relation.tags.join("+")}"` : "";
  const label = relation.description ?? "";
  return `Rel(${from}, ${relation.to}, "${label}"${tech}${tags})`;
};

const collectBoundedContainerNames = (model: Model): Set<string> => {
  const names = new Set<string>();
  const visit = (boundary: Boundary): void => {
    for (const n of boundary.containerNames) names.add(n);
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
  standaloneContainers: readonly Container[],
  boundaryLabel: string | undefined,
): readonly string[] => {
  const rootBoundaries = model.rootBoundaryNames
    .map((n) => getBoundary(model, n))
    .filter((b): b is Boundary => b !== undefined);

  if (boundaryLabel) {
    return [
      `Boundary(project, "${boundaryLabel}") {`,
      ...rootBoundaries.map((b) => renderBoundary(model, b, "  ")),
      ...standaloneContainers.map((c) => `  ${renderContainer(c)}`),
      `}`,
    ];
  }
  return [
    ...rootBoundaries.map((b) => renderBoundary(model, b, "")),
    ...standaloneContainers.map((c) => renderContainer(c)),
  ];
};

export const generate = (
  model: Model,
  options?: PlantumlGenerateOptions,
): FormatOutput => {
  const boundedNames = collectBoundedContainerNames(model);
  const standalone = Object.values(model.containers).filter(
    (c) => !boundedNames.has(c.name),
  );

  const relations = Object.values(model.containers).flatMap((container) =>
    container.relations.map((rel) => renderRelation(container.name, rel)),
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

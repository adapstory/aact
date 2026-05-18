import type { Boundary, Container, Model } from "../../model";
import { getBoundary, getContainer } from "../../model";
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
const isContextKind = (kind: Container["kind"]): boolean =>
  kind === "Person" || kind === "System";

/**
 * Resolve the PUML alias slot for an element. After the v3
 * display-name refactor, `Container.name` is the human-readable label
 * (which may contain spaces and is invalid as a PUML alias). The
 * loader stashes the original alias in `properties["plantuml.alias"]`
 * — we prefer it. For elements that originated outside PUML (e.g. a
 * Structurizr workspace.json or hand-built Model in tests), fall back
 * to a sanitised slug of the name.
 */
const aliasOf = (el: {
  name: string;
  properties?: Readonly<Record<string, string>>;
}): string =>
  el.properties?.["plantuml.alias"] ?? el.name.replaceAll(/\W/g, "_");

const renderContainer = (container: Container): string => {
  const macro = c4MacroName(container.kind, container.external);
  const parts: string[] = [aliasOf(container), `"${container.label}"`];

  if (isContextKind(container.kind)) {
    // Person/System: alias, label, descr (no techn)
    if (container.description) parts.push(`"${container.description}"`);
  } else {
    // Container/Component family: alias, label, techn, descr
    if (container.technology) parts.push(`"${container.technology}"`);
    else if (container.description) parts.push('""'); // pad techn slot
    if (container.description) parts.push(`"${container.description}"`);
  }

  const named: string[] = [];
  if (container.sprite) named.push(`$sprite="${container.sprite}"`);
  if (container.tags.length > 0)
    named.push(`$tags="${container.tags.join("+")}"`);
  if (container.link) named.push(`$link="${container.link}"`);

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
  const childContainers = boundary.containerNames
    .map((name) => getContainer(model, name))
    .filter((c): c is Container => c !== undefined)
    .map((c) => `${inner}${renderContainer(c)}`);

  // Boundary signature: Boundary(alias, label, ?type, ?tags, ?link)
  const parts: string[] = [aliasOf(boundary), `"${boundary.label}"`];
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
  fromAlias: string,
  relation: Container["relations"][number],
  toAlias: string,
): string => {
  const label = relation.description ?? "";
  const parts: string[] = [fromAlias, toAlias, `"${label}"`];
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
    container.relations.map((rel) => {
      // Resolve `rel.to` (a display name) back to the alias slot for
      // PUML output. If the target lives in the Model, use its alias;
      // otherwise sanitise the display name as a fallback.
      const target = getContainer(model, rel.to);
      const toAlias = target ? aliasOf(target) : rel.to.replaceAll(/\W/g, "_");
      return renderRelation(aliasOf(container), rel, toAlias);
    }),
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

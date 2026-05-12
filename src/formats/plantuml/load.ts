import fs from "node:fs/promises";

import path from "pathe";
import type { UMLElement } from "plantuml-parser";
import {
  Comment,
  parse as parsePuml,
  Stdlib_C4_Boundary,
  Stdlib_C4_Container_Component,
  Stdlib_C4_Context,
  Stdlib_C4_Dynamic_Rel,
} from "plantuml-parser";

import type { Boundary, Container, Relation } from "../../model";
import { buildModel } from "../../model";
import { parseBoundaryMacro, parseC4MacroKind } from "../_shared/c4Mapping";
import { parseCsvTags } from "../_shared/tags";
import type { LoadResult } from "../types";
import { filterElements } from "./lib/filterElements";

/**
 * plantuml-parser 0.4 не поддерживает $tags="..." named syntax — pre-transform
 * конвертит в positional строку. Это легаси-hack из v2: `$tags="X"` становится
 * `"X"` в позиции descr/etc. в зависимости от macro signature. Сохраняем для
 * compatibility с existing .puml fixtures.
 */
const preTransformDollarTags = (raw: string): string =>
  raw.replaceAll(/, \$tags=(".+?")/g, ", $1").replaceAll('""', '" "');

/**
 * Rel_Back (обратное направление стрелки) семантически = Rel(to, from). Swap
 * before mapping — иначе loader выдаст backwards relations.
 */
const normalizeRelBack = (elements: UMLElement[]): void => {
  for (const element of elements) {
    if (element instanceof Comment) continue;
    if (!(element instanceof Stdlib_C4_Dynamic_Rel)) continue;
    if (element.type_.name.startsWith("Rel_Back")) {
      const from = element.from;
      element.from = element.to;
      element.to = from;
    }
  }
};

const buildContainer = (
  el: Stdlib_C4_Context | Stdlib_C4_Container_Component,
): Container => {
  const macroKind = parseC4MacroKind(el.type_.name);
  const kind = macroKind?.kind ?? "Container";
  const external = macroKind?.external ?? false;

  // Container_Component variants имеют `techn` (4-й позиционный); Context
  // (Person/System) — нет. TS narrowing через instanceof выбрал бы один,
  // но проще проверить наличие поля.
  const technology =
    "techn" in el && typeof el.techn === "string" && el.techn.length > 0
      ? el.techn
      : undefined;

  // plantuml-parser 0.4 не поддерживает $tags="X" named syntax — pre-transform
  // конвертит в positional. На контейнерах с `Container(alias, label, $tags="X")`
  // значение приземляется в slot sprite (position 5), не tags (position 6).
  // Fallback: если tags пусты, а sprite выглядит как tag-list — читаем sprite
  // как tags. Backward-compat с old aact-стиль writer'ом + user'ами писавшими
  // `$tags=` без full positional pad.
  const explicitTags = parseCsvTags(el.tags);
  const spriteValue = el.sprite || "";
  const usedSpriteAsTags = explicitTags.length === 0 && spriteValue.length > 0;
  const tags = usedSpriteAsTags ? parseCsvTags(spriteValue) : explicitTags;
  const sprite = usedSpriteAsTags ? undefined : spriteValue || undefined;

  return {
    name: el.alias,
    label: el.label,
    kind,
    external,
    description: el.descr || "",
    technology,
    tags,
    sprite,
    relations: [],
    link: el.link || undefined,
  };
};

const buildRelation = (rel: Stdlib_C4_Dynamic_Rel): Relation => ({
  to: rel.to,
  description: rel.label || undefined,
  technology: rel.techn || undefined,
  tags: parseCsvTags(rel.descr || rel.tags),
  sprite: rel.sprite || undefined,
  link: rel.link || undefined,
});

const buildBoundary = (
  el: Stdlib_C4_Boundary,
  childContainers: readonly string[],
  childBoundaries: readonly string[],
): Boundary => ({
  name: el.alias,
  label: el.label,
  kind: parseBoundaryMacro(el.type_.name),
  tags: parseCsvTags(el.tags),
  containerNames: childContainers,
  boundaryNames: childBoundaries,
  link: el.link || undefined,
});

const isC4Element = (
  el: UMLElement,
): el is Stdlib_C4_Context | Stdlib_C4_Container_Component =>
  el instanceof Stdlib_C4_Context ||
  el instanceof Stdlib_C4_Container_Component;

const collectBoundaryChildren = (
  el: Stdlib_C4_Boundary,
): { containers: string[]; boundaries: string[] } => {
  const containers: string[] = [];
  const boundaries: string[] = [];
  for (const child of el.elements) {
    if (isC4Element(child)) containers.push(child.alias);
    else if (child instanceof Stdlib_C4_Boundary) boundaries.push(child.alias);
  }
  return { containers, boundaries };
};

export const load = async (filePath: string): Promise<LoadResult> => {
  const filepath = path.resolve(filePath);
  const raw = await fs.readFile(filepath, "utf8");
  const transformed = preTransformDollarTags(raw);
  const [{ elements: rawElements }] = parsePuml(transformed);
  const elements = filterElements(rawElements);

  normalizeRelBack(elements);

  // Pass 1: containers (Person/System/Container/Component variants)
  const containerByAlias: Record<string, Container> = Object.create(
    null,
  ) as Record<string, Container>;
  for (const el of elements) {
    if (!isC4Element(el)) continue;
    containerByAlias[el.alias] = buildContainer(el);
  }

  // Pass 2: relations — push в existing containers' .relations
  for (const el of elements) {
    if (!(el instanceof Stdlib_C4_Dynamic_Rel)) continue;
    const source = containerByAlias[el.from];
    if (!source) continue; // dangling — validateModel surface'ит
    const relation = buildRelation(el);
    containerByAlias[el.from] = {
      ...source,
      relations: [...source.relations, relation],
    };
  }

  // Pass 3: boundaries + root detection
  const boundaryElements = elements.filter(
    (el): el is Stdlib_C4_Boundary => el instanceof Stdlib_C4_Boundary,
  );
  const childOfBoundary = new Set<string>();
  for (const b of boundaryElements) {
    for (const child of b.elements) {
      if (child instanceof Stdlib_C4_Boundary) {
        childOfBoundary.add(child.alias);
      }
    }
  }
  const boundaries = boundaryElements.map((b) => {
    const { containers, boundaries: childBoundaries } =
      collectBoundaryChildren(b);
    return buildBoundary(b, containers, childBoundaries);
  });
  const rootBoundaryNames = boundaries
    .map((b) => b.name)
    .filter((name) => !childOfBoundary.has(name));

  return buildModel({
    containers: Object.values(containerByAlias),
    boundaries,
    rootBoundaryNames,
  });
};

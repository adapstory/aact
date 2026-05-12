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
 * plantuml-parser 0.4 не поддерживает named-arg syntax `$tags="..."`. Мы
 * перепаковываем такие named args в positional с unique marker prefix —
 * loader потом извлекает их из любой positional slot без конфликта с
 * real values в той же позиции.
 *
 * Old hack (just strip $tags=, leave bare value) ломался на реальных
 * sprites: `Container(svc, "L", "Java", "D", "java-logo")` parser давал
 * sprite="java-logo", и loader не отличал от sprite-как-tags fallback.
 */
const TAGS_MARKER = "__aact_tags__:";
const LINK_MARKER = "__aact_link__:";
const SPRITE_MARKER = "__aact_sprite__:";

const preTransformNamedArgs = (raw: string): string =>
  raw
    .replaceAll(/, \$tags="(.+?)"/g, `, "${TAGS_MARKER}$1"`)
    .replaceAll(/, \$link="(.+?)"/g, `, "${LINK_MARKER}$1"`)
    .replaceAll(/, \$sprite="(.+?)"/g, `, "${SPRITE_MARKER}$1"`)
    .replaceAll('""', '" "');

const stripMarker = (
  value: string | undefined,
  marker: string,
): string | undefined =>
  value && value.startsWith(marker) ? value.slice(marker.length) : undefined;

/** Возвращает первое не-undefined значение из slot'ов после strip'а marker'а. */
const extractMarked = (
  marker: string,
  ...slots: (string | undefined)[]
): string | undefined => {
  for (const slot of slots) {
    const v = stripMarker(slot, marker);
    if (v !== undefined) return v;
  }
  return undefined;
};

/** Возвращает slot value если в нём НЕТ ни одного из marker'ов, иначе undefined. */
const cleanSlot = (
  value: string | undefined,
  ...markers: string[]
): string | undefined => {
  if (!value) return undefined;
  if (markers.some((m) => value.startsWith(m))) return undefined;
  return value;
};

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

const ALL_MARKERS = [TAGS_MARKER, LINK_MARKER, SPRITE_MARKER];

const buildContainer = (
  el: Stdlib_C4_Context | Stdlib_C4_Container_Component,
): Container => {
  const macroKind = parseC4MacroKind(el.type_.name);
  const kind = macroKind?.kind ?? "Container";
  const external = macroKind?.external ?? false;

  // Container_Component variants имеют `techn` (4-й позиционный); Context
  // (Person/System) — нет. instanceof narrow обходит через "techn" in el.
  const rawTechn =
    "techn" in el && typeof el.techn === "string" ? el.techn : undefined;

  // Named args ($tags=, $link=, $sprite=) могут приземлиться в любой
  // positional slot в зависимости от того, сколько positional уже
  // заполнено. Извлекаем по marker'у независимо от позиции.
  const taggedValue = extractMarked(
    TAGS_MARKER,
    rawTechn,
    el.descr,
    el.sprite,
    el.tags,
    el.link,
  );
  const linkValue = extractMarked(
    LINK_MARKER,
    rawTechn,
    el.descr,
    el.sprite,
    el.tags,
    el.link,
  );
  const spriteNamedValue = extractMarked(
    SPRITE_MARKER,
    rawTechn,
    el.descr,
    el.sprite,
    el.tags,
    el.link,
  );

  return {
    name: el.alias,
    label: el.label,
    kind,
    external,
    description: cleanSlot(el.descr, ...ALL_MARKERS) ?? "",
    technology: cleanSlot(rawTechn, ...ALL_MARKERS),
    tags:
      taggedValue === undefined
        ? parseCsvTags(cleanSlot(el.tags, ...ALL_MARKERS))
        : parseCsvTags(taggedValue),
    sprite: spriteNamedValue ?? cleanSlot(el.sprite, ...ALL_MARKERS),
    relations: [],
    link: linkValue ?? cleanSlot(el.link, ...ALL_MARKERS),
  };
};

const buildRelation = (rel: Stdlib_C4_Dynamic_Rel): Relation => {
  // Same marker-strip logic — Rel signature: from, to, label, techn, descr,
  // sprite, tags, link. Any named arg может оказаться в любой positional.
  const taggedValue = extractMarked(
    TAGS_MARKER,
    rel.techn,
    rel.descr,
    rel.sprite,
    rel.tags,
    rel.link,
  );
  const linkValue = extractMarked(
    LINK_MARKER,
    rel.techn,
    rel.descr,
    rel.sprite,
    rel.tags,
    rel.link,
  );
  const spriteNamedValue = extractMarked(
    SPRITE_MARKER,
    rel.techn,
    rel.descr,
    rel.sprite,
    rel.tags,
    rel.link,
  );

  return {
    to: rel.to,
    description: cleanSlot(rel.label, ...ALL_MARKERS) || undefined,
    technology: cleanSlot(rel.techn, ...ALL_MARKERS),
    tags:
      taggedValue === undefined
        ? parseCsvTags(
            cleanSlot(rel.descr, ...ALL_MARKERS) ||
              cleanSlot(rel.tags, ...ALL_MARKERS),
          )
        : parseCsvTags(taggedValue),
    sprite: spriteNamedValue ?? cleanSlot(rel.sprite, ...ALL_MARKERS),
    link: linkValue ?? cleanSlot(rel.link, ...ALL_MARKERS),
  };
};

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
  const transformed = preTransformNamedArgs(raw);
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

  // Pass 2: relations — push в existing containers' .relations.
  // BiRel(a, b) / BiRel_D/U/L/R / BiRel_Neighbor = directed Rel(a, b) +
  // Rel(b, a). Loader expand'ит в две, чтобы downstream rules видели
  // обе стороны графа симметрично (как Structurizr делает с
  // implied relationships).
  for (const el of elements) {
    if (!(el instanceof Stdlib_C4_Dynamic_Rel)) continue;

    const forwardSource = containerByAlias[el.from];
    if (forwardSource) {
      containerByAlias[el.from] = {
        ...forwardSource,
        relations: [...forwardSource.relations, buildRelation(el)],
      };
    }

    if (el.type_.name.startsWith("BiRel")) {
      const reverseSource = containerByAlias[el.to];
      if (reverseSource) {
        containerByAlias[el.to] = {
          ...reverseSource,
          relations: [
            ...reverseSource.relations,
            buildRelation({ ...el, from: el.to, to: el.from }),
          ],
        };
      }
    }
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

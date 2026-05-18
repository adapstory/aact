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

// ───────────────────────────────────────────────────────────────────────────
// plantuml-parser 0.4 adapter
//
// The third-party `plantuml-parser` 0.4 has grammar gaps that this section
// works around. It is a self-contained unit — when the chevrotain parser
// lands in v3.x, this whole block is deleted in one commit.
//
// Gap closed here:
//   Named-arg syntax (`$tags=`, `$link=`, `$sprite=`, `$index=`) — the
//   parser drops the entire element when it sees a named arg. We repack
//   named args into positional slots with a unique marker prefix; the
//   loader then extracts them from whichever slot they landed in.
//
// Old hack (just strip `$tags=`, leave bare value) broke on real sprites:
// `Container(svc, "L", "Java", "D", "java-logo")` gave sprite="java-logo"
// and the loader could not tell it from a sprite-as-tags fallback.
// ───────────────────────────────────────────────────────────────────────────
const TAGS_MARKER = "__aact_tags__:";
const LINK_MARKER = "__aact_link__:";
const SPRITE_MARKER = "__aact_sprite__:";
const INDEX_MARKER = "__aact_index__:";

const preTransform = (raw: string): string =>
  raw
    .replaceAll(/, \$tags="(.+?)"/g, `, "${TAGS_MARKER}$1"`)
    .replaceAll(/, \$link="(.+?)"/g, `, "${LINK_MARKER}$1"`)
    .replaceAll(/, \$sprite="(.+?)"/g, `, "${SPRITE_MARKER}$1"`)
    // $index= accepts both quoted (`$index="1"`) and bare numeric
    // (`$index=1`) forms in C4-PlantUML — handle both.
    .replaceAll(
      /, \$index=(?:"([^"]+)"|([^,)\s]+))/g,
      (_match, quoted: string | undefined, bare: string | undefined) =>
        `, "${INDEX_MARKER}${quoted ?? bare ?? ""}"`,
    )
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

const ALL_MARKERS = [TAGS_MARKER, LINK_MARKER, SPRITE_MARKER, INDEX_MARKER];

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
    // C4 semantic: `name` is the human-readable display name (the
    // PUML `label` arg). The short alias (`api`, `db`) is stashed in
    // properties so the fix layer can locate the element in source.
    name: el.label,
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
    properties: Object.freeze({ "plantuml.alias": el.alias }),
  };
};

const buildRelation = (
  rel: Stdlib_C4_Dynamic_Rel,
  aliasToName: ReadonlyMap<string, string>,
): Relation => {
  // Same marker-strip logic — Rel signature: from, to, label, techn, descr,
  // sprite, tags, link. Any named arg может оказаться в любой positional.
  const relSlots = [
    rel.techn,
    rel.descr,
    rel.sprite,
    rel.tags,
    rel.link,
  ] as const;
  const taggedValue = extractMarked(TAGS_MARKER, ...relSlots);
  const linkValue = extractMarked(LINK_MARKER, ...relSlots);
  const spriteNamedValue = extractMarked(SPRITE_MARKER, ...relSlots);
  // $index= (dynamic-diagram step order) → Relation.order. Non-numeric
  // values degrade to undefined rather than NaN.
  const indexValue = extractMarked(INDEX_MARKER, ...relSlots);
  const order =
    indexValue !== undefined && Number.isFinite(Number(indexValue))
      ? Number(indexValue)
      : undefined;

  return {
    // Resolve the alias-form `rel.to` to its display name so edges
    // index Containers by the same key as the rest of the Model.
    to: aliasToName.get(rel.to) ?? rel.to,
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
    order,
  };
};

const buildBoundary = (
  el: Stdlib_C4_Boundary,
  childContainers: readonly string[],
  childBoundaries: readonly string[],
): Boundary => {
  // Same marker-strip как в buildContainer/buildRelation: $tags=/$link=
  // могут приземлиться в любой positional slot (parser имеет tags+link).
  const taggedValue = extractMarked(TAGS_MARKER, el.tags, el.link);
  const linkValue = extractMarked(LINK_MARKER, el.tags, el.link);

  return {
    name: el.label,
    label: el.label,
    kind: parseBoundaryMacro(el.type_.name),
    tags:
      taggedValue === undefined
        ? parseCsvTags(cleanSlot(el.tags, ...ALL_MARKERS))
        : parseCsvTags(taggedValue),
    containerNames: childContainers,
    boundaryNames: childBoundaries,
    link: linkValue ?? cleanSlot(el.link, ...ALL_MARKERS),
    properties: Object.freeze({ "plantuml.alias": el.alias }),
  };
};

const isC4Element = (
  el: UMLElement,
): el is Stdlib_C4_Context | Stdlib_C4_Container_Component =>
  el instanceof Stdlib_C4_Context ||
  el instanceof Stdlib_C4_Container_Component;

const collectBoundaryChildren = (
  el: Stdlib_C4_Boundary,
  aliasToName: ReadonlyMap<string, string>,
): { containers: string[]; boundaries: string[] } => {
  const containers: string[] = [];
  const boundaries: string[] = [];
  for (const child of el.elements) {
    if (isC4Element(child)) {
      containers.push(aliasToName.get(child.alias) ?? child.alias);
    } else if (child instanceof Stdlib_C4_Boundary) {
      boundaries.push(aliasToName.get(child.alias) ?? child.alias);
    }
  }
  return { containers, boundaries };
};

const pushRelation = (
  acc: Record<string, Container>,
  sourceName: string,
  relation: Relation,
): void => {
  const source = acc[sourceName];
  if (!source) return;
  acc[sourceName] = {
    ...source,
    relations: [...source.relations, relation],
  };
};

/**
 * BiRel(a, b) / BiRel_D/U/L/R / BiRel_Neighbor — directed Rel(a, b) +
 * Rel(b, a). Loader expand'ит в две, чтобы downstream rules видели
 * обе стороны графа симметрично (как Structurizr делает с implied
 * relationships).
 */
const populateRelations = (
  elements: readonly UMLElement[],
  acc: Record<string, Container>,
  aliasToName: ReadonlyMap<string, string>,
): void => {
  for (const el of elements) {
    if (!(el instanceof Stdlib_C4_Dynamic_Rel)) continue;
    const fromName = aliasToName.get(el.from) ?? el.from;
    pushRelation(acc, fromName, buildRelation(el, aliasToName));
    if (el.type_.name.startsWith("BiRel")) {
      const toName = aliasToName.get(el.to) ?? el.to;
      pushRelation(
        acc,
        toName,
        buildRelation({ ...el, from: el.to, to: el.from }, aliasToName),
      );
    }
  }
};

const collectChildBoundaryNames = (
  boundaryElements: readonly Stdlib_C4_Boundary[],
  aliasToName: ReadonlyMap<string, string>,
): Set<string> => {
  const childOfBoundary = new Set<string>();
  for (const b of boundaryElements) {
    for (const child of b.elements) {
      if (child instanceof Stdlib_C4_Boundary) {
        childOfBoundary.add(aliasToName.get(child.alias) ?? child.alias);
      }
    }
  }
  return childOfBoundary;
};

export const load = async (filePath: string): Promise<LoadResult> => {
  const filepath = path.resolve(filePath);
  const raw = await fs.readFile(filepath, "utf8");
  const transformed = preTransform(raw);
  const [{ elements: rawElements }] = parsePuml(transformed);
  const elements = filterElements(rawElements);

  normalizeRelBack(elements);

  // Pass 0: alias → display-name index. PUML uses an alias (`api`,
  // `db`) as the inline reference but the Model keys everything by
  // display name (`"API"`, `"DB"`). We build the index in one sweep
  // over containers + boundaries so the rest of the loader can map
  // alias references on either side of a relation or boundary edge.
  const aliasToName = new Map<string, string>();
  for (const el of elements) {
    if (isC4Element(el) || el instanceof Stdlib_C4_Boundary) {
      aliasToName.set(el.alias, el.label);
    }
  }

  // Pass 1: containers (Person/System/Container/Component variants),
  // keyed by display name in the working dict.
  const containerByName: Record<string, Container> = Object.create(
    null,
  ) as Record<string, Container>;
  for (const el of elements) {
    if (isC4Element(el)) containerByName[el.label] = buildContainer(el);
  }

  // Pass 2: relations (с BiRel expansion); rel.to / rel.from resolve
  // through `aliasToName`.
  populateRelations(elements, containerByName, aliasToName);

  // Pass 3: boundaries + root detection — boundary children also
  // resolve through `aliasToName`.
  const boundaryElements = elements.filter(
    (el): el is Stdlib_C4_Boundary => el instanceof Stdlib_C4_Boundary,
  );
  const childOfBoundary = collectChildBoundaryNames(
    boundaryElements,
    aliasToName,
  );
  const boundaries = boundaryElements.map((b) => {
    const { containers, boundaries: childBoundaries } = collectBoundaryChildren(
      b,
      aliasToName,
    );
    return buildBoundary(b, containers, childBoundaries);
  });
  const rootBoundaryNames = boundaries
    .map((b) => b.name)
    .filter((name) => !childOfBoundary.has(name));

  return buildModel({
    containers: Object.values(containerByName),
    boundaries,
    rootBoundaryNames,
  });
};

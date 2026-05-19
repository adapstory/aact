import type {
  Boundary,
  Element,
  Model,
  Relation,
  SourceLocation,
} from "./types";

/**
 * O(1) element lookup. Возвращает undefined для dangling references
 * (которые validateModel ловит как ModelIssue).
 */
export const getElement = (m: Model, name: string): Element | undefined =>
  m.elements[name];

/**
 * O(1) boundary lookup.
 */
export const getBoundary = (m: Model, name: string): Boundary | undefined =>
  m.boundaries[name];

/**
 * Resolve целевого Element'а по Relation.to (name-ref). Самый частый
 * pattern в правилах: `targetOf(model, rel)?.kind === "ContainerDb"`.
 */
export const targetOf = (m: Model, rel: Relation): Element | undefined =>
  m.elements[rel.to];

/**
 * Все elements в model как массив. Удобно для `.filter()` / `.map()`,
 * когда нужен flat iteration.
 */
export const allElements = (m: Model): Element[] => Object.values(m.elements);

/**
 * Все boundaries в model как массив.
 */
export const allBoundaries = (m: Model): Boundary[] =>
  Object.values(m.boundaries);

/**
 * Format `loc` as the canonical `<file>:<line>:<col>` string. Library-
 * safe — pure data formatter, never emits escape sequences. Used by
 * GitHub annotations, JSON / Slack / PR / dashboard renderers, and as
 * the human-readable inline label whenever a structured
 * `SourceLocation` needs to land in plain text.
 */
export const formatLocation = (loc: SourceLocation): string =>
  `${loc.file}:${loc.start.line}:${loc.start.col}`;

/**
 * Depth-first iteration всех boundaries — от root'ов вглубь. Visited set
 * защищает от accidental cycles (validateModel ловит их явно).
 */
export const walkBoundaries = function* (m: Model): Generator<Boundary> {
  const visited = new Set<string>();
  const visit = function* (name: string): Generator<Boundary> {
    if (visited.has(name)) return;
    visited.add(name);
    const b = m.boundaries[name];
    if (!b) return;
    yield b;
    for (const child of b.boundaryNames) yield* visit(child);
  };
  for (const root of m.rootBoundaryNames) yield* visit(root);
};

import type { Boundary, Container, Model, Relation } from "./types";

/**
 * O(1) container lookup. Возвращает undefined для dangling references
 * (которые validateModel ловит как ModelIssue).
 */
export const getContainer = (m: Model, name: string): Container | undefined =>
  m.containers[name];

/**
 * O(1) boundary lookup.
 */
export const getBoundary = (m: Model, name: string): Boundary | undefined =>
  m.boundaries[name];

/**
 * Resolve целевого Container'а по Relation.to (name-ref). Самый частый
 * pattern в правилах: `targetOf(model, rel)?.kind === "ContainerDb"`.
 */
export const targetOf = (m: Model, rel: Relation): Container | undefined =>
  m.containers[rel.to];

/**
 * Все контейнеры в model как массив. Удобно для `.filter()` / `.map()`,
 * когда нужен flat iteration.
 */
export const allContainers = (m: Model): Container[] =>
  Object.values(m.containers);

/**
 * Все boundaries в model как массив.
 */
export const allBoundaries = (m: Model): Boundary[] =>
  Object.values(m.boundaries);

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

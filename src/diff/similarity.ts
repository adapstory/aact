/**
 * Multi-feature similarity scoring for the rename detector. Replaces
 * the older `0.5 · max(label, name) + 0.5 · jaccard(relations)` formula
 * with a weighted combination of seven signals.
 *
 * Weights are hand-picked from EMF Compare / SiDiff conventions plus
 * domain experience on C4 graphs — see the WHY column below. Tunable
 * via `SimilarityWeights` (PR-time experiments) but not exposed in
 * `DiffOptions` to keep the public contract small. If a real user
 * wants to tune, we add a config surface then.
 *
 * | Weight       | Default | Why                                                                                                                                     |
 * | ------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
 * | `name`       | 0.25    | Primary identifier. Changes on the very refactor we're detecting, but partial matches (`api` → `apiV2`) still anchor.                   |
 * | `label`      | 0.15    | Human-facing name; often correlates with `name`. Secondary signal — labels routinely tweak during refactor.                             |
 * | `technology` | 0.20    | Highly distinctive. `"Spring Boot"` rarely changes during rename — a hard-match is strong evidence "this IS the same thing". Raised from 0.15 after benchmark showed it carries chain-rename leaf cases (`db ↔ primaryDb` where name/label drift but tech anchors). |
 * | `external`   | 0.05    | Rarely toggled; mismatch is strong (internal service ≠ external partner) but contributes little when both equal.                        |
 * | `tags`       | 0.10    | Domain-specific signal. Some models tag heavily, some never. Jaccard over both gives partial credit for tag overlap.                    |
 * | `relations`  | 0.25    | Structural neighborhood — for an unrenamed element, every outgoing relation stays the same. Jaccard over `.to` names (after rename remap when caller supplies one). |
 *
 * `kind` is NOT a weighted feature — it's a hard gate: cross-kind
 * scores `Number.POSITIVE_INFINITY` cost (forbidden). When the
 * caller opts into `relaxKindFamilies`, within-family kind mismatches
 * (`Container` ↔ `ContainerDb`) drop to a soft penalty instead.
 *
 * `description` is intentionally excluded — long prose is fragile;
 * users routinely tweak descriptions during refactor, and short
 * descriptions don't carry enough signal to be worth the weight
 * slot.
 */

import type { Boundary, Element } from "../model";

export interface SimilarityWeights {
  readonly name: number;
  readonly label: number;
  readonly technology: number;
  readonly external: number;
  readonly tags: number;
  readonly relations: number;
}

export const DEFAULT_ELEMENT_WEIGHTS: SimilarityWeights = {
  name: 0.25,
  label: 0.15,
  technology: 0.2,
  external: 0.05,
  tags: 0.1,
  relations: 0.25,
};

/**
 * Boundaries don't carry technology / external / outgoing relations,
 * so we redistribute those weight slots onto the remaining features.
 * Containment (elementNames / boundaryNames) takes the relations slot.
 */
export interface BoundarySimilarityWeights {
  readonly name: number;
  readonly label: number;
  readonly tags: number;
  readonly elementNames: number;
  readonly boundaryNames: number;
}

export const DEFAULT_BOUNDARY_WEIGHTS: BoundarySimilarityWeights = {
  name: 0.3,
  label: 0.25,
  tags: 0.1,
  elementNames: 0.25,
  boundaryNames: 0.1,
};

/**
 * Two elements within the same C4 "kind family" (Container ↔
 * ContainerDb ↔ ContainerQueue, Component ↔ ComponentDb ↔
 * ComponentQueue) — semantically the same level, often a
 * cross-format inference artefact rather than a real refactor.
 */
const CONTAINER_FAMILY = new Set<string>([
  "Container",
  "ContainerDb",
  "ContainerQueue",
]);
const COMPONENT_FAMILY = new Set<string>([
  "Component",
  "ComponentDb",
  "ComponentQueue",
]);

const sameKindFamily = (a: string, b: string): boolean => {
  if (a === b) return true;
  if (CONTAINER_FAMILY.has(a) && CONTAINER_FAMILY.has(b)) return true;
  if (COMPONENT_FAMILY.has(a) && COMPONENT_FAMILY.has(b)) return true;
  return false;
};

// ─── String similarity (Levenshtein-based, length-normalised) ─────────

const levenshtein = (a: string, b: string): number => {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr: number[] = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const aChar = a.codePointAt(i - 1);
      const bChar = b.codePointAt(j - 1);
      const cost = aChar === bChar ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
};

export const stringSimilarity = (a: string, b: string): number => {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
};

// ─── Jaccard for string sets ─────────────────────────────────────────

const jaccard = (a: readonly string[], b: readonly string[]): number => {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const x of setA) if (setB.has(x)) intersection++;
  const unionSize = setA.size + setB.size - intersection;
  if (unionSize === 0) return 1;
  return intersection / unionSize;
};

// ─── Element similarity ──────────────────────────────────────────────

/**
 * Element similarity, gated by kind. Returns `0` when the two
 * elements have different kinds and `relaxKindFamilies` is `false`
 * (the default — the caller wraps this into a `Number.POSITIVE_INFINITY`
 * cost for Hungarian). When `relaxKindFamilies` is set, within-family
 * kind transitions get a soft 0.85× multiplier on the final score.
 *
 * `renameMap` rewrites baseline-side relation targets to current-side
 * names so chain renames feed back into similarity scoring. Empty map
 * means "no rename context yet" — first iteration.
 */
export const elementSimilarity = (
  a: Element,
  b: Element,
  options: {
    readonly weights?: SimilarityWeights;
    readonly relaxKindFamilies?: boolean;
    readonly renameMap?: ReadonlyMap<string, string>;
  } = {},
): number => {
  const weights = options.weights ?? DEFAULT_ELEMENT_WEIGHTS;
  let kindPenalty = 1;
  if (a.kind !== b.kind) {
    if (!options.relaxKindFamilies) return 0;
    if (!sameKindFamily(a.kind, b.kind)) return 0;
    kindPenalty = 0.85;
  }

  const nameSim = stringSimilarity(a.name, b.name);
  const labelSim = stringSimilarity(a.label, b.label);
  const techEq = (a.technology ?? "") === (b.technology ?? "") ? 1 : 0;
  const extEq = a.external === b.external ? 1 : 0;
  const tagSim = jaccard(a.tags, b.tags);

  const renameMap = options.renameMap;
  const remappedTargets = renameMap
    ? a.relations.map((r) => renameMap.get(r.to) ?? r.to)
    : a.relations.map((r) => r.to);
  const relSim = jaccard(
    remappedTargets,
    b.relations.map((r) => r.to),
  );

  const score =
    weights.name * nameSim +
    weights.label * labelSim +
    weights.technology * techEq +
    weights.external * extEq +
    weights.tags * tagSim +
    weights.relations * relSim;

  return score * kindPenalty;
};

// ─── Boundary similarity ─────────────────────────────────────────────

export const boundarySimilarity = (
  a: Boundary,
  b: Boundary,
  options: {
    readonly weights?: BoundarySimilarityWeights;
    readonly renameMap?: ReadonlyMap<string, string>;
  } = {},
): number => {
  const weights = options.weights ?? DEFAULT_BOUNDARY_WEIGHTS;
  if (a.kind !== b.kind) return 0; // hard gate

  const renameMap = options.renameMap;
  const remappedElems = renameMap
    ? a.elementNames.map((n) => renameMap.get(n) ?? n)
    : a.elementNames;

  return (
    weights.name * stringSimilarity(a.name, b.name) +
    weights.label * stringSimilarity(a.label, b.label) +
    weights.tags * jaccard(a.tags, b.tags) +
    weights.elementNames * jaccard(remappedElems, b.elementNames) +
    weights.boundaryNames * jaccard(a.boundaryNames, b.boundaryNames)
  );
};

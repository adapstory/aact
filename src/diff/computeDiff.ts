import type {
  Boundary,
  Element,
  Model,
  Relation,
  WorkspaceMetadata,
} from "../model";
import type {
  BoundaryChange,
  Change,
  ChangeAction,
  ChangeSeverity,
  DiffData,
  DiffOptions,
  DiffSide,
  DiffSummary,
  ElementChange,
  FieldChange,
  FieldKind,
  JsonPatchOp,
  RelationChange,
  WorkspaceChange,
} from "./types";

/**
 * Pure structural-diff engine for two normalized C4 Models. CLI
 * wrappers around this live in `src/cli/commands/diff/`; the
 * algorithm itself stays at the model layer so library users can
 * compute diffs without booting the CLI surface.
 *
 * Algorithm in three passes (no side effects, no I/O):
 *
 *  1. Element / Boundary / Relation identity match — name-based for
 *     elements / boundaries, `(from, to, technology)` tuple for
 *     relations. Matched pairs land in `modified` with per-field
 *     deltas; unmatched go to `added` / `removed`.
 *  2. Rename detection — for each removed/added pair of the same
 *     `kind`, compute similarity (label edit-distance + relations
 *     Jaccard). Pairs scoring ≥ threshold (default 0.7) collapse
 *     into a single `renamed` change with `confidence`.
 *  3. Relation pair-collapse — `(from, to)` groups with exactly one
 *     removed and one added entry mean the technology was swapped
 *     in place; surface as `modified` with `field: "technology"`,
 *     not noisy add+remove pair. Easier to read on PR review.
 *
 * Sorting: severity desc → action precedence → address asc. First
 * entries of `changes[]` are always the highest-impact ones.
 */

// -----------------------------------------------------------------------------
// Utility helpers
// -----------------------------------------------------------------------------

const ACTION_PRECEDENCE: Record<ChangeAction, number> = {
  removed: 0,
  added: 1,
  modified: 2,
  renamed: 3,
  moved: 4,
};

const SEVERITY_PRECEDENCE: Record<ChangeSeverity, number> = {
  structural: 0,
  semantic: 1,
  cosmetic: 2,
};

const FIELD_SEVERITY: Record<FieldKind, ChangeSeverity> = {
  kind: "structural",
  external: "semantic",
  technology: "semantic",
  description: "cosmetic",
  label: "cosmetic",
  tags: "semantic",
  sprite: "cosmetic",
  link: "cosmetic",
  properties: "semantic",
  boundary: "structural",
  order: "semantic",
  "workspace.name": "cosmetic",
  "workspace.description": "cosmetic",
  "workspace.extendsTarget": "cosmetic",
  elementNames: "structural",
  boundaryNames: "structural",
};

const aggregateSeverity = (fields: readonly FieldChange[]): ChangeSeverity => {
  let max: ChangeSeverity = "cosmetic";
  for (const f of fields) {
    const sev = FIELD_SEVERITY[f.field];
    if (SEVERITY_PRECEDENCE[sev] < SEVERITY_PRECEDENCE[max]) max = sev;
  }
  return max;
};

const normTech = (t: string | undefined): string => (t ?? "").trim();

const stringArraysEqual = (
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): boolean => {
  const aa = a ?? [];
  const bb = b ?? [];
  if (aa.length !== bb.length) return false;
  const setB = new Set(bb);
  return aa.every((x) => setB.has(x));
};

const setDelta = (
  before: readonly string[] | undefined,
  after: readonly string[] | undefined,
): { added: string[]; removed: string[] } => {
  const beforeSet = new Set(before ?? []);
  const afterSet = new Set(after ?? []);
  const added: string[] = [];
  const removed: string[] = [];
  for (const x of afterSet) if (!beforeSet.has(x)) added.push(x);
  for (const x of beforeSet) if (!afterSet.has(x)) removed.push(x);
  return { added, removed };
};

const propertiesEqual = (
  a: Readonly<Record<string, string>> | undefined,
  b: Readonly<Record<string, string>> | undefined,
): boolean => {
  const compare = (x: string, y: string): number => x.localeCompare(y);
  const aKeys = Object.keys(a ?? {}).sort(compare);
  const bKeys = Object.keys(b ?? {}).sort(compare);
  if (aKeys.length !== bKeys.length) return false;
  for (const [i, key] of aKeys.entries()) {
    if (key !== bKeys[i]) return false;
    if ((a ?? {})[key] !== (b ?? {})[key]) return false;
  }
  return true;
};

// -----------------------------------------------------------------------------
// Similarity (rename detector)
// -----------------------------------------------------------------------------

const levenshtein = (a: string, b: string): number => {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr: number[] = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
};

const stringSimilarity = (a: string, b: string): number => {
  if (a === "" && b === "") return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
};

const jaccard = (a: readonly string[], b: readonly string[]): number => {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const x of setA) if (setB.has(x)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 1 : intersection / union;
};

const elementSimilarity = (a: Element, b: Element): number => {
  // Compare on what people typically keep stable across renames:
  // the label, and the set of outgoing relation targets. Tags and
  // technology contribute lightly but aren't decisive — a refactor
  // often moves a service across boundaries while keeping the
  // label and roughly the same dependencies.
  const labelSim = stringSimilarity(a.label, b.label);
  const nameSim = stringSimilarity(a.name, b.name);
  const relationsSim = jaccard(
    a.relations.map((r) => r.to),
    b.relations.map((r) => r.to),
  );
  return Math.max(labelSim, nameSim) * 0.5 + relationsSim * 0.5;
};

const boundarySimilarity = (a: Boundary, b: Boundary): number => {
  const labelSim = stringSimilarity(a.label, b.label);
  const nameSim = stringSimilarity(a.name, b.name);
  const elementsSim = jaccard(a.elementNames, b.elementNames);
  return Math.max(labelSim, nameSim) * 0.5 + elementsSim * 0.5;
};

interface RenamePair<T> {
  readonly removed: T;
  readonly added: T;
  readonly confidence: number;
}

const detectRenames = <T extends { kind: string }>(
  removed: readonly T[],
  added: readonly T[],
  similarity: (a: T, b: T) => number,
  threshold: number,
): RenamePair<T>[] => {
  const matches: RenamePair<T>[] = [];
  const removedTaken = new Set<T>();
  const addedTaken = new Set<T>();

  // Score every cross-product pair of same kind, sort desc, then
  // greedy assignment. Quadratic in worst case but n is small
  // (typical PRs touch ≤10 elements) so this is fine.
  const scored: { r: T; a: T; score: number }[] = [];
  for (const r of removed) {
    for (const a of added) {
      if (r.kind !== a.kind) continue;
      const score = similarity(r, a);
      if (score >= threshold) scored.push({ r, a, score });
    }
  }
  scored.sort((x, y) => y.score - x.score);
  for (const { r, a, score } of scored) {
    if (removedTaken.has(r) || addedTaken.has(a)) continue;
    matches.push({ removed: r, added: a, confidence: score });
    removedTaken.add(r);
    addedTaken.add(a);
  }
  return matches;
};

// -----------------------------------------------------------------------------
// Per-entity diff
// -----------------------------------------------------------------------------

const diffElementFields = (
  before: Element,
  after: Element,
  boundaryBefore: string | undefined,
  boundaryAfter: string | undefined,
): FieldChange[] => {
  const fields: FieldChange[] = [];
  if (before.kind !== after.kind) {
    fields.push({ field: "kind", before: before.kind, after: after.kind });
  }
  if (before.external !== after.external) {
    fields.push({
      field: "external",
      before: before.external,
      after: after.external,
    });
  }
  if (normTech(before.technology) !== normTech(after.technology)) {
    fields.push({
      field: "technology",
      before: before.technology,
      after: after.technology,
    });
  }
  if (before.label !== after.label) {
    fields.push({ field: "label", before: before.label, after: after.label });
  }
  if (before.description !== after.description) {
    fields.push({
      field: "description",
      before: before.description,
      after: after.description,
    });
  }
  if (!stringArraysEqual(before.tags, after.tags)) {
    const delta = setDelta(before.tags, after.tags);
    fields.push({
      field: "tags",
      before: before.tags,
      after: after.tags,
      ...(delta.added.length > 0 ? { added: delta.added } : {}),
      ...(delta.removed.length > 0 ? { removed: delta.removed } : {}),
    });
  }
  if (before.sprite !== after.sprite) {
    fields.push({
      field: "sprite",
      before: before.sprite,
      after: after.sprite,
    });
  }
  if (before.link !== after.link) {
    fields.push({ field: "link", before: before.link, after: after.link });
  }
  if (!propertiesEqual(before.properties, after.properties)) {
    fields.push({
      field: "properties",
      before: before.properties,
      after: after.properties,
    });
  }
  if (boundaryBefore !== boundaryAfter) {
    fields.push({
      field: "boundary",
      before: boundaryBefore,
      after: boundaryAfter,
    });
  }
  return fields;
};

const diffBoundaryFields = (
  before: Boundary,
  after: Boundary,
): FieldChange[] => {
  const fields: FieldChange[] = [];
  if (before.kind !== after.kind) {
    fields.push({ field: "kind", before: before.kind, after: after.kind });
  }
  if (before.label !== after.label) {
    fields.push({ field: "label", before: before.label, after: after.label });
  }
  if (before.description !== after.description) {
    fields.push({
      field: "description",
      before: before.description,
      after: after.description,
    });
  }
  if (!stringArraysEqual(before.tags, after.tags)) {
    const delta = setDelta(before.tags, after.tags);
    fields.push({
      field: "tags",
      before: before.tags,
      after: after.tags,
      ...(delta.added.length > 0 ? { added: delta.added } : {}),
      ...(delta.removed.length > 0 ? { removed: delta.removed } : {}),
    });
  }
  if (!stringArraysEqual(before.elementNames, after.elementNames)) {
    const delta = setDelta(before.elementNames, after.elementNames);
    fields.push({
      field: "elementNames",
      before: before.elementNames,
      after: after.elementNames,
      ...(delta.added.length > 0 ? { added: delta.added } : {}),
      ...(delta.removed.length > 0 ? { removed: delta.removed } : {}),
    });
  }
  if (!stringArraysEqual(before.boundaryNames, after.boundaryNames)) {
    const delta = setDelta(before.boundaryNames, after.boundaryNames);
    fields.push({
      field: "boundaryNames",
      before: before.boundaryNames,
      after: after.boundaryNames,
      ...(delta.added.length > 0 ? { added: delta.added } : {}),
      ...(delta.removed.length > 0 ? { removed: delta.removed } : {}),
    });
  }
  if (before.link !== after.link) {
    fields.push({ field: "link", before: before.link, after: after.link });
  }
  if (!propertiesEqual(before.properties, after.properties)) {
    fields.push({
      field: "properties",
      before: before.properties,
      after: after.properties,
    });
  }
  return fields;
};

const diffRelationFields = (
  before: Relation,
  after: Relation,
): FieldChange[] => {
  const fields: FieldChange[] = [];
  if (before.description !== after.description) {
    fields.push({
      field: "description",
      before: before.description,
      after: after.description,
    });
  }
  if (!stringArraysEqual(before.tags, after.tags)) {
    const delta = setDelta(before.tags, after.tags);
    fields.push({
      field: "tags",
      before: before.tags,
      after: after.tags,
      ...(delta.added.length > 0 ? { added: delta.added } : {}),
      ...(delta.removed.length > 0 ? { removed: delta.removed } : {}),
    });
  }
  if (before.order !== after.order) {
    fields.push({ field: "order", before: before.order, after: after.order });
  }
  if (!propertiesEqual(before.properties, after.properties)) {
    fields.push({
      field: "properties",
      before: before.properties,
      after: after.properties,
    });
  }
  return fields;
};

// -----------------------------------------------------------------------------
// Address helpers
// -----------------------------------------------------------------------------

const elementAddress = (name: string): string => `element:${name}`;
const boundaryAddress = (name: string): string => `boundary:${name}`;
const relationAddress = (from: string, to: string, tech?: string): string =>
  tech ? `relation:${from}→${to}(${tech})` : `relation:${from}→${to}`;
const workspaceAddress = (): string => "workspace";

// -----------------------------------------------------------------------------
// Boundary index (which boundary owns each element name?)
// -----------------------------------------------------------------------------

const buildElementBoundaryMap = (model: Model): Map<string, string> => {
  const out = new Map<string, string>();
  for (const b of Object.values(model.boundaries)) {
    for (const n of b.elementNames) out.set(n, b.name);
  }
  return out;
};

// -----------------------------------------------------------------------------
// Element diff
// -----------------------------------------------------------------------------

const diffElements = (
  baseline: Model,
  current: Model,
  options: DiffOptions,
): { changes: ElementChange[]; renameMap: Map<string, string> } => {
  const changes: ElementChange[] = [];
  const renameMap = new Map<string, string>();
  const baselineBoundaries = buildElementBoundaryMap(baseline);
  const currentBoundaries = buildElementBoundaryMap(current);

  const baselineNames = new Set(Object.keys(baseline.elements));
  const currentNames = new Set(Object.keys(current.elements));

  const removed: Element[] = [];
  const added: Element[] = [];
  for (const name of baselineNames) {
    if (!currentNames.has(name)) removed.push(baseline.elements[name]);
  }
  for (const name of currentNames) {
    if (!baselineNames.has(name)) added.push(current.elements[name]);
  }

  const renamePairs: RenamePair<Element>[] = options.disableRenameDetection
    ? []
    : detectRenames(
        removed,
        added,
        elementSimilarity,
        options.renameThreshold ?? 0.7,
      );
  const renamedRemoved = new Set(renamePairs.map((p) => p.removed));
  const renamedAdded = new Set(renamePairs.map((p) => p.added));
  for (const pair of renamePairs) {
    renameMap.set(pair.removed.name, pair.added.name);
  }

  for (const pair of renamePairs) {
    const fields = diffElementFields(
      pair.removed,
      pair.added,
      baselineBoundaries.get(pair.removed.name),
      currentBoundaries.get(pair.added.name),
    );
    // Rename itself is structural — name change is the load-bearing
    // signal, regardless of which other fields moved.
    changes.push({
      entity: "element",
      action: "renamed",
      severity: "structural",
      address: elementAddress(pair.added.name),
      name: pair.added.name,
      previousName: pair.removed.name,
      confidence: pair.confidence,
      kind: pair.added.kind,
      fields,
    });
  }

  for (const el of removed) {
    if (renamedRemoved.has(el)) continue;
    changes.push({
      entity: "element",
      action: "removed",
      severity: "structural",
      address: elementAddress(el.name),
      name: el.name,
      kind: el.kind,
      fields: [],
    });
  }
  for (const el of added) {
    if (renamedAdded.has(el)) continue;
    changes.push({
      entity: "element",
      action: "added",
      severity: "structural",
      address: elementAddress(el.name),
      name: el.name,
      kind: el.kind,
      fields: [],
    });
  }

  // Matched (same name in both) — diff per field.
  for (const name of baselineNames) {
    if (!currentNames.has(name)) continue;
    const before = baseline.elements[name];
    const after = current.elements[name];
    const fields = diffElementFields(
      before,
      after,
      baselineBoundaries.get(name),
      currentBoundaries.get(name),
    );
    if (fields.length === 0) continue;
    const hasBoundaryMove = fields.some((f) => f.field === "boundary");
    changes.push({
      entity: "element",
      action: hasBoundaryMove && fields.length === 1 ? "moved" : "modified",
      severity: aggregateSeverity(fields),
      address: elementAddress(name),
      name,
      kind: after.kind,
      fields,
    });
  }
  return { changes, renameMap };
};

// -----------------------------------------------------------------------------
// Boundary diff
// -----------------------------------------------------------------------------

const diffBoundaries = (
  baseline: Model,
  current: Model,
  options: DiffOptions,
): BoundaryChange[] => {
  const changes: BoundaryChange[] = [];
  const baselineNames = new Set(Object.keys(baseline.boundaries));
  const currentNames = new Set(Object.keys(current.boundaries));

  const removed: Boundary[] = [];
  const added: Boundary[] = [];
  for (const name of baselineNames) {
    if (!currentNames.has(name)) removed.push(baseline.boundaries[name]);
  }
  for (const name of currentNames) {
    if (!baselineNames.has(name)) added.push(current.boundaries[name]);
  }

  const renamePairs: RenamePair<Boundary>[] = options.disableRenameDetection
    ? []
    : detectRenames(
        removed,
        added,
        boundarySimilarity,
        options.renameThreshold ?? 0.7,
      );
  const renamedRemoved = new Set(renamePairs.map((p) => p.removed));
  const renamedAdded = new Set(renamePairs.map((p) => p.added));

  for (const pair of renamePairs) {
    const fields = diffBoundaryFields(pair.removed, pair.added);
    changes.push({
      entity: "boundary",
      action: "renamed",
      severity: "structural",
      address: boundaryAddress(pair.added.name),
      name: pair.added.name,
      previousName: pair.removed.name,
      confidence: pair.confidence,
      kind: pair.added.kind,
      fields,
    });
  }

  for (const b of removed) {
    if (renamedRemoved.has(b)) continue;
    changes.push({
      entity: "boundary",
      action: "removed",
      severity: "structural",
      address: boundaryAddress(b.name),
      name: b.name,
      kind: b.kind,
      fields: [],
    });
  }
  for (const b of added) {
    if (renamedAdded.has(b)) continue;
    changes.push({
      entity: "boundary",
      action: "added",
      severity: "structural",
      address: boundaryAddress(b.name),
      name: b.name,
      kind: b.kind,
      fields: [],
    });
  }

  for (const name of baselineNames) {
    if (!currentNames.has(name)) continue;
    const before = baseline.boundaries[name];
    const after = current.boundaries[name];
    const fields = diffBoundaryFields(before, after);
    if (fields.length === 0) continue;
    changes.push({
      entity: "boundary",
      action: "modified",
      severity: aggregateSeverity(fields),
      address: boundaryAddress(name),
      name,
      kind: after.kind,
      fields,
    });
  }
  return changes;
};

// -----------------------------------------------------------------------------
// Relation diff
// -----------------------------------------------------------------------------

interface IndexedRelation {
  readonly from: string;
  readonly rel: Relation;
  readonly id: string;
}

const indexRelations = (model: Model): IndexedRelation[] => {
  const out: IndexedRelation[] = [];
  for (const el of Object.values(model.elements)) {
    for (const rel of el.relations) {
      const tech = normTech(rel.technology);
      out.push({
        from: el.name,
        rel,
        id: tech ? `${el.name}\0${rel.to}\0${tech}` : `${el.name}\0${rel.to}\0`,
      });
    }
  }
  return out;
};

const remapRelationId = (
  r: IndexedRelation,
  renameMap: ReadonlyMap<string, string>,
): string => {
  const newFrom = renameMap.get(r.from) ?? r.from;
  const newTo = renameMap.get(r.rel.to) ?? r.rel.to;
  const tech = normTech(r.rel.technology);
  return tech ? `${newFrom}\0${newTo}\0${tech}` : `${newFrom}\0${newTo}\0`;
};

const diffRelations = (
  baseline: Model,
  current: Model,
  /** old-name → new-name map from rename detection, so relations
   *  touching renamed elements match the new names. */
  renameMap: ReadonlyMap<string, string> = new Map(),
): RelationChange[] => {
  const baselineRels = indexRelations(baseline);
  const currentRels = indexRelations(current);

  // Multiset matching: when the same (from, to, technology) triple
  // appears multiple times on either side, pair them by index so
  // duplicates survive instead of getting Map-overwritten. Important
  // for Dynamic-view sequences and any model that legitimately
  // repeats an edge.
  const baselineByRemappedId = new Map<string, IndexedRelation[]>();
  for (const r of baselineRels) {
    const remappedId = remapRelationId(r, renameMap);
    const bucket = baselineByRemappedId.get(remappedId);
    if (bucket) bucket.push(r);
    else baselineByRemappedId.set(remappedId, [r]);
  }
  const currentById = new Map<string, IndexedRelation[]>();
  for (const r of currentRels) {
    const bucket = currentById.get(r.id);
    if (bucket) bucket.push(r);
    else currentById.set(r.id, [r]);
  }

  const removed: IndexedRelation[] = [];
  const added: IndexedRelation[] = [];
  const modified: RelationChange[] = [];

  // Identity match by remapped (from, to, technology); pair by
  // bucket index so duplicates survive.
  for (const [remappedId, baseBucket] of baselineByRemappedId) {
    const currBucket = currentById.get(remappedId) ?? [];
    const matchCount = Math.min(baseBucket.length, currBucket.length);
    for (let i = 0; i < matchCount; i++) {
      const r = baseBucket[i];
      const match = currBucket[i];
      const fields = diffRelationFields(r.rel, match.rel);
      if (fields.length > 0) {
        modified.push({
          entity: "relation",
          action: "modified",
          severity: aggregateSeverity(fields),
          address: relationAddress(
            match.from,
            match.rel.to,
            normTech(match.rel.technology) || undefined,
          ),
          from: match.from,
          to: match.rel.to,
          ...(match.rel.technology ? { technology: match.rel.technology } : {}),
          fields,
        });
      }
    }
    for (let i = matchCount; i < baseBucket.length; i++) {
      removed.push(baseBucket[i]);
    }
  }
  for (const [id, currBucket] of currentById) {
    const matched = baselineByRemappedId.get(id)?.length ?? 0;
    for (let i = matched; i < currBucket.length; i++) added.push(currBucket[i]);
  }

  // Pair-collapse: same (from, to) with exactly one removed + one
  // added → "technology swapped in place", surface as modified. We
  // remap baseline-side keys through the rename map so a relation
  // touching a renamed element still pairs with its current-side
  // counterpart instead of looking like a stale add+remove.
  const removedByPair = new Map<string, IndexedRelation[]>();
  const addedByPair = new Map<string, IndexedRelation[]>();
  const pairKey = (r: IndexedRelation): string => `${r.from}\0${r.rel.to}`;
  const remappedPairKey = (r: IndexedRelation): string => {
    const newFrom = renameMap.get(r.from) ?? r.from;
    const newTo = renameMap.get(r.rel.to) ?? r.rel.to;
    return `${newFrom}\0${newTo}`;
  };
  for (const r of removed) {
    const k = remappedPairKey(r);
    const list = removedByPair.get(k);
    if (list) list.push(r);
    else removedByPair.set(k, [r]);
  }
  for (const r of added) {
    const k = pairKey(r);
    const list = addedByPair.get(k);
    if (list) list.push(r);
    else addedByPair.set(k, [r]);
  }
  const collapsedRemoved = new Set<IndexedRelation>();
  const collapsedAdded = new Set<IndexedRelation>();
  for (const [k, rems] of removedByPair) {
    const adds = addedByPair.get(k);
    if (!adds) continue;
    if (rems.length !== 1 || adds.length !== 1) continue;
    const r = rems[0];
    const a = adds[0];
    const fields: FieldChange[] = [
      {
        field: "technology",
        before: r.rel.technology,
        after: a.rel.technology,
      },
      ...diffRelationFields(r.rel, a.rel),
    ];
    // Use the current-side names — when the source/target was
    // renamed, the collapsed entry should reflect the new name.
    modified.push({
      entity: "relation",
      action: "modified",
      severity: aggregateSeverity(fields),
      address: relationAddress(a.from, a.rel.to),
      from: a.from,
      to: a.rel.to,
      ...(a.rel.technology ? { technology: a.rel.technology } : {}),
      fields,
    });
    collapsedRemoved.add(r);
    collapsedAdded.add(a);
  }

  const result: RelationChange[] = [...modified];
  for (const r of removed) {
    if (collapsedRemoved.has(r)) continue;
    result.push({
      entity: "relation",
      action: "removed",
      severity: "structural",
      address: relationAddress(
        r.from,
        r.rel.to,
        normTech(r.rel.technology) || undefined,
      ),
      from: r.from,
      to: r.rel.to,
      ...(r.rel.technology ? { technology: r.rel.technology } : {}),
      fields: [],
    });
  }
  for (const r of added) {
    if (collapsedAdded.has(r)) continue;
    result.push({
      entity: "relation",
      action: "added",
      severity: "structural",
      address: relationAddress(
        r.from,
        r.rel.to,
        normTech(r.rel.technology) || undefined,
      ),
      from: r.from,
      to: r.rel.to,
      ...(r.rel.technology ? { technology: r.rel.technology } : {}),
      fields: [],
    });
  }
  return result;
};

// -----------------------------------------------------------------------------
// Workspace diff
// -----------------------------------------------------------------------------

const diffWorkspace = (
  baseline: WorkspaceMetadata | undefined,
  current: WorkspaceMetadata | undefined,
): WorkspaceChange[] => {
  const fields: FieldChange[] = [];
  if ((baseline?.name ?? "") !== (current?.name ?? "")) {
    fields.push({
      field: "workspace.name",
      before: baseline?.name,
      after: current?.name,
    });
  }
  if ((baseline?.description ?? "") !== (current?.description ?? "")) {
    fields.push({
      field: "workspace.description",
      before: baseline?.description,
      after: current?.description,
    });
  }
  if ((baseline?.extendsTarget ?? "") !== (current?.extendsTarget ?? "")) {
    fields.push({
      field: "workspace.extendsTarget",
      before: baseline?.extendsTarget,
      after: current?.extendsTarget,
    });
  }
  if (fields.length === 0) return [];
  return [
    {
      entity: "workspace",
      action: "modified",
      severity: aggregateSeverity(fields),
      address: workspaceAddress(),
      fields,
    },
  ];
};

// -----------------------------------------------------------------------------
// Summary + sort
// -----------------------------------------------------------------------------

const compareChanges = (a: Change, b: Change): number => {
  const sevDiff =
    SEVERITY_PRECEDENCE[a.severity] - SEVERITY_PRECEDENCE[b.severity];
  if (sevDiff !== 0) return sevDiff;
  const actDiff = ACTION_PRECEDENCE[a.action] - ACTION_PRECEDENCE[b.action];
  if (actDiff !== 0) return actDiff;
  return a.address.localeCompare(b.address);
};

const pickDominantSeverity = (
  bySeverity: DiffSummary["bySeverity"],
): ChangeSeverity => {
  if (bySeverity.structural > 0) return "structural";
  if (bySeverity.semantic > 0) return "semantic";
  return "cosmetic";
};

const buildHeadline = (
  changes: readonly Change[],
  bySeverity: DiffSummary["bySeverity"],
): string => {
  if (changes.length === 0) return "no changes";
  const parts: string[] = [];
  const elements = changes.filter((c) => c.entity === "element");
  const relations = changes.filter((c) => c.entity === "relation");
  const boundaries = changes.filter((c) => c.entity === "boundary");
  const elAdded = elements.filter((c) => c.action === "added").length;
  const elRemoved = elements.filter((c) => c.action === "removed").length;
  const elRenamed = elements.filter((c) => c.action === "renamed").length;
  const relAdded = relations.filter((c) => c.action === "added").length;
  const relRemoved = relations.filter((c) => c.action === "removed").length;
  const bndAdded = boundaries.filter((c) => c.action === "added").length;
  const bndRemoved = boundaries.filter((c) => c.action === "removed").length;
  const techChanges = changes.filter((c) =>
    c.fields.some((f) => f.field === "technology"),
  ).length;
  if (elAdded > 0) parts.push(`+${elAdded} element${elAdded === 1 ? "" : "s"}`);
  if (elRemoved > 0)
    parts.push(`-${elRemoved} element${elRemoved === 1 ? "" : "s"}`);
  if (elRenamed > 0) parts.push(`~${elRenamed} renamed`);
  if (bndAdded > 0)
    parts.push(`+${bndAdded} boundar${bndAdded === 1 ? "y" : "ies"}`);
  if (bndRemoved > 0)
    parts.push(`-${bndRemoved} boundar${bndRemoved === 1 ? "y" : "ies"}`);
  if (relAdded > 0)
    parts.push(`+${relAdded} relation${relAdded === 1 ? "" : "s"}`);
  if (relRemoved > 0)
    parts.push(`-${relRemoved} relation${relRemoved === 1 ? "" : "s"}`);
  if (techChanges > 0)
    parts.push(
      `${techChanges} technology change${techChanges === 1 ? "" : "s"}`,
    );
  if (parts.length === 0) parts.push(`${changes.length} change(s)`);
  const dominantSeverity = pickDominantSeverity(bySeverity);
  return `${parts.join(", ")} [${dominantSeverity}]`;
};

const buildSummary = (changes: readonly Change[]): DiffSummary => {
  const bySeverity: DiffSummary["bySeverity"] = {
    structural: 0,
    semantic: 0,
    cosmetic: 0,
  };
  const byAction: DiffSummary["byAction"] = {
    added: 0,
    removed: 0,
    modified: 0,
    renamed: 0,
    moved: 0,
  };
  const byEntity: DiffSummary["byEntity"] = {
    element: 0,
    boundary: 0,
    relation: 0,
    workspace: 0,
  };
  for (const c of changes) {
    bySeverity[c.severity]++;
    byAction[c.action]++;
    byEntity[c.entity]++;
  }
  return {
    headline: buildHeadline(changes, bySeverity),
    bySeverity,
    byAction,
    byEntity,
  };
};

// -----------------------------------------------------------------------------
// RFC 6902 patch (opt-in)
// -----------------------------------------------------------------------------

const stripElementLocation = (el: Element): Element => {
  const copy: Record<string, unknown> = { ...el };
  delete copy.sourceLocation;
  copy.relations = el.relations.map((r) => {
    const rc: Record<string, unknown> = { ...r };
    delete rc.sourceLocation;
    return rc as unknown as Element["relations"][number];
  });
  return copy as unknown as Element;
};

const stripBoundaryLocation = (b: Boundary): Boundary => {
  const copy: Record<string, unknown> = { ...b };
  delete copy.sourceLocation;
  return copy as unknown as Boundary;
};

const stripSourceLocation = (model: Model): Model => {
  const elements: Record<string, Element> = {};
  for (const [k, v] of Object.entries(model.elements)) {
    elements[k] = stripElementLocation(v);
  }
  const boundaries: Record<string, Boundary> = {};
  for (const [k, v] of Object.entries(model.boundaries)) {
    boundaries[k] = stripBoundaryLocation(v);
  }
  return {
    elements,
    boundaries,
    rootBoundaryNames: model.rootBoundaryNames,
    ...(model.workspace ? { workspace: model.workspace } : {}),
  };
};

const computePatch = (baseline: Model, current: Model): JsonPatchOp[] => {
  // Simple recursive diff producing RFC 6902 ops. Not optimal
  // (doesn't use LCS for arrays) but correct and small. For
  // sophisticated patch consumers, agents can use a dedicated
  // JSON Patch library on the model-json snapshot.
  const ops: JsonPatchOp[] = [];
  const walk = (a: unknown, b: unknown, path: string): void => {
    if (Object.is(a, b)) return;
    if (
      typeof a !== "object" ||
      typeof b !== "object" ||
      a === null ||
      b === null ||
      Array.isArray(a) !== Array.isArray(b)
    ) {
      ops.push({ op: "replace", path, value: b });
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (JSON.stringify(a) === JSON.stringify(b)) return;
      ops.push({ op: "replace", path, value: b });
      return;
    }
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
    for (const k of keys) {
      const subPath = `${path}/${k.replaceAll("~", "~0").replaceAll("/", "~1")}`;
      if (!(k in bObj)) ops.push({ op: "remove", path: subPath });
      else if (k in aObj) {
        walk(aObj[k], bObj[k], subPath);
      } else {
        ops.push({ op: "add", path: subPath, value: bObj[k] });
      }
    }
  };
  walk(stripSourceLocation(baseline), stripSourceLocation(current), "");
  return ops;
};

// -----------------------------------------------------------------------------
// Public entry point
// -----------------------------------------------------------------------------

/**
 * Compute the structural diff between two C4 Models. Pure function —
 * no I/O, no globals; safe to call from any layer that has access
 * to model objects (CLI command, library API, test fixtures).
 *
 * Sources passed in describe *what* baseline and current are
 * (file path, git ref, stdin label) — not loaded — and end up in
 * the envelope so downstream consumers can render headers without
 * tracking provenance separately.
 */
export const computeDiff = (
  baseline: Model,
  current: Model,
  baselineSide: DiffSide,
  currentSide: DiffSide,
  options: DiffOptions = {},
): DiffData => {
  const { changes: elementChanges, renameMap } = diffElements(
    baseline,
    current,
    options,
  );
  const boundaryChanges = diffBoundaries(baseline, current, options);
  const relationChanges = diffRelations(baseline, current, renameMap);
  const workspaceChanges = diffWorkspace(baseline.workspace, current.workspace);

  const allChanges: Change[] = [
    ...elementChanges,
    ...boundaryChanges,
    ...relationChanges,
    ...workspaceChanges,
  ].sort(compareChanges);

  const summary = buildSummary(allChanges);
  return {
    summary,
    changes: allChanges,
    ...(options.withPatch ? { patch: computePatch(baseline, current) } : {}),
    baseline: baselineSide,
    current: currentSide,
  };
};

import type { Element, Model, Relation } from "./adapstoryUtils";
import {
  allElements,
  matchesPattern,
  relationText,
  targetOf,
} from "./adapstoryUtils";
import type { RuleDefinition, Violation } from "./types";

const DEFAULT_CORE_BC_TAGS = [
  "bc-01",
  "bc-02",
  "bc-10",
  "bc-11",
  "bc-15",
  "bc-16",
  "bc-19",
];

export interface AdapstoryNoCoreBcCyclesOptions {
  coreBcTags?: string[];
  ignoredMatrixDecisionPattern?: RegExp;
  ignoredSourceTagPattern?: RegExp;
}

const DEFAULT_IGNORED_MATRIX_DECISION_PATTERN = /counts-for-core-cycle:false/i;
const DEFAULT_IGNORED_SOURCE_TAG_PATTERN =
  /(^bff$|^gateway$|edge-composition)/i;
const REVIEWED_EVIDENCE_PATTERN = /reviewed[-_\s]?overlay|reviewed overlay/i;
const MATRIX_SOURCE_PATTERN = /source:core-dependency-decision-matrix/i;
const CORE_DECISION_PATTERN =
  /core-decision:(event|read-model|acl|command|edge-composition)/i;
const OWNER_BC_PATTERN = /owner-bc:bc-\d+/i;
const DOWNSTREAM_BC_PATTERN = /downstream-bc:bc-\d+/i;

const bcTagFor = (
  container: Element,
  coreBcTags: readonly string[],
): string | undefined => {
  return coreBcTags.find((tag) => container.tags.includes(tag));
};

const canonicalCycle = (cycle: readonly string[]): string[] => {
  const body = cycle.slice(0, -1);
  let best = body;

  for (let index = 1; index < body.length; index += 1) {
    const rotated = [...body.slice(index), ...body.slice(0, index)];
    if (rotated.join("\0") < best.join("\0")) {
      best = rotated;
    }
  }

  return [...best, best[0]];
};

const cycleKey = (cycle: readonly string[]): string => cycle.join(" -> ");

const isIgnoredMatrixDecision = (
  relation: Relation,
  ignoredMatrixDecisionPattern: RegExp,
): boolean => {
  const text = relationText(relation);
  return (
    matchesPattern(REVIEWED_EVIDENCE_PATTERN, text) &&
    matchesPattern(MATRIX_SOURCE_PATTERN, text) &&
    matchesPattern(CORE_DECISION_PATTERN, text) &&
    matchesPattern(OWNER_BC_PATTERN, text) &&
    matchesPattern(DOWNSTREAM_BC_PATTERN, text) &&
    matchesPattern(ignoredMatrixDecisionPattern, text)
  );
};

const hasIgnoredSourceTag = (
  container: Element,
  ignoredSourceTagPattern: RegExp,
): boolean =>
  container.tags.some((tag) => matchesPattern(ignoredSourceTagPattern, tag));

const findCycles = (graph: Map<string, Set<string>>): string[][] => {
  const cycles = new Map<string, string[]>();

  const visit = (start: string, current: string, path: string[]): void => {
    for (const next of graph.get(current) ?? []) {
      if (next === start) {
        const canonical = canonicalCycle([...path, start]);
        cycles.set(cycleKey(canonical), canonical);
        continue;
      }
      if (path.includes(next)) continue;
      visit(start, next, [...path, next]);
    }
  };

  for (const node of graph.keys()) {
    visit(node, node, [node]);
  }

  return [...cycles.values()].toSorted((a, b) =>
    cycleKey(a).localeCompare(cycleKey(b)),
  );
};

export const checkAdapstoryNoCoreBcCycles = (
  model: Model,
  options?: AdapstoryNoCoreBcCyclesOptions,
): Violation[] => {
  const coreBcTags = options?.coreBcTags ?? DEFAULT_CORE_BC_TAGS;
  const ignoredMatrixDecisionPattern =
    options?.ignoredMatrixDecisionPattern ??
    DEFAULT_IGNORED_MATRIX_DECISION_PATTERN;
  const ignoredSourceTagPattern =
    options?.ignoredSourceTagPattern ?? DEFAULT_IGNORED_SOURCE_TAG_PATTERN;
  const containerBc = new Map<string, string>();

  for (const container of allElements(model)) {
    const bcTag = bcTagFor(container, coreBcTags);
    if (bcTag) {
      containerBc.set(container.name, bcTag);
    }
  }

  const graph = new Map<string, Set<string>>();
  for (const bcTag of coreBcTags) {
    graph.set(bcTag, new Set());
  }

  for (const container of allElements(model)) {
    const sourceBc = containerBc.get(container.name);
    if (!sourceBc) continue;
    if (hasIgnoredSourceTag(container, ignoredSourceTagPattern)) continue;

    for (const relation of container.relations) {
      if (isIgnoredMatrixDecision(relation, ignoredMatrixDecisionPattern)) {
        continue;
      }
      const target = targetOf(model, relation);
      const targetBc = target ? containerBc.get(target.name) : undefined;
      if (!targetBc || targetBc === sourceBc) continue;
      graph.get(sourceBc)?.add(targetBc);
    }
  }

  return findCycles(graph).map((cycle) => ({
    target: cycle[0],
    targetKind: "boundary" as const,
    message: `core bounded context cycle detected: ${cycleKey(cycle)}`,
  }));
};

export const adapstoryNoCoreBcCyclesRule: RuleDefinition<AdapstoryNoCoreBcCyclesOptions> =
  {
    name: "adapstory-no-core-bc-cycles",
    description: "Core bounded contexts must not form dependency cycles.",
    check: checkAdapstoryNoCoreBcCycles,
  };

import type { Boundary, Element, Model, Relation } from "./model";
import { allElements, getBoundary, getElement } from "./model";

export interface CouplingRelation {
  from: string;
  to: string;
}

export interface BoundaryAnalysis {
  name: string;
  label: string;
  cohesion: number;
  coupling: number;
  couplingRelations: CouplingRelation[];
}

interface DatabasesInfo {
  count: number;
  consumes: number;
}

export interface AnalysisReport {
  elementsCount: number;
  syncApiCalls: number;
  asyncApiCalls: number;
  databases: DatabasesInfo;
  boundaries: BoundaryAnalysis[];
}

export interface AnalyzedArchitecture {
  model: Model;
  report: AnalysisReport;
}

interface RelationWithSource {
  from: Element;
  relation: Relation;
}

export interface AnalyzeOptions {
  apiTechnologies?: readonly string[];
}

const DEFAULT_API_TECHNOLOGIES = ["http", "grpc", "tcp"];

const allRelations = (model: Model): RelationWithSource[] =>
  allElements(model).flatMap((element) =>
    element.relations.map((relation) => ({ from: element, relation })),
  );

const classifyRelation = (
  names: Set<string>,
  childNames: Set<string> | undefined,
  parentBoundary: Boundary | undefined,
  from: Element,
  relation: Relation,
  result: BoundaryAnalysis,
  parentResult: BoundaryAnalysis | undefined,
): void => {
  if (!names.has(from.name)) return;

  if (names.has(relation.to)) {
    result.cohesion++;
    return;
  }

  const isInParentSibling = childNames?.has(relation.to) ?? false;

  if (!parentBoundary || isInParentSibling) {
    result.coupling++;
    result.couplingRelations.push({ from: from.name, to: relation.to });
    if (parentResult) parentResult.cohesion++;
  } else if (parentResult) {
    parentResult.coupling++;
    parentResult.couplingRelations.push({
      from: from.name,
      to: relation.to,
    });
  }
};

interface BoundaryLookups {
  nameSet: Set<string>;
  childNames: Set<string> | undefined;
  parentBoundary: Boundary | undefined;
}

const buildBoundaryLookups = (model: Model): Map<string, BoundaryLookups> => {
  const boundaries = Object.values(model.boundaries);
  const nameSets = new Map(
    boundaries.map((b) => [b.name, new Set(b.elementNames)]),
  );

  const parentMap = new Map<string, Boundary>();
  for (const b of boundaries) {
    for (const childName of b.boundaryNames) {
      const child = getBoundary(model, childName);
      if (child) parentMap.set(child.name, b);
    }
  }

  const result = new Map<string, BoundaryLookups>();
  for (const b of boundaries) {
    const parentBoundary = parentMap.get(b.name);
    let childNames: Set<string> | undefined;
    if (parentBoundary) {
      childNames = new Set<string>();
      for (const siblingName of parentBoundary.boundaryNames) {
        const sibling = getBoundary(model, siblingName);
        if (sibling) {
          for (const cName of sibling.elementNames) childNames.add(cName);
        }
      }
    }
    result.set(b.name, {
      nameSet: nameSets.get(b.name)!,
      childNames,
      parentBoundary,
    });
  }
  return result;
};

const isSyncApiCall = (
  model: Model,
  it: RelationWithSource,
  apiTechnologies: readonly string[],
): boolean => {
  if (it.relation.tags.includes("async")) return false;
  const target = getElement(model, it.relation.to);
  if (target?.external === true && target.kind === "System") return true;
  return apiTechnologies.some((t) =>
    (it.relation.technology ?? "").toLowerCase().includes(t),
  );
};

const analyzeModel = (
  model: Model,
  options?: AnalyzeOptions,
): AnalysisReport => {
  const apiTechnologies = options?.apiTechnologies ?? DEFAULT_API_TECHNOLOGIES;
  const relations = allRelations(model);

  const asyncApiCalls = relations.filter((it) =>
    it.relation.tags.includes("async"),
  );
  const syncApiCalls = relations.filter((it) =>
    isSyncApiCall(model, it, apiTechnologies),
  );

  const lookups = buildBoundaryLookups(model);

  const boundaryResults = new Map<string, BoundaryAnalysis>();
  for (const boundary of Object.values(model.boundaries)) {
    boundaryResults.set(boundary.name, {
      name: boundary.name,
      label: boundary.label,
      cohesion: 0,
      coupling: 0,
      couplingRelations: [],
    });
  }

  for (const boundary of Object.values(model.boundaries)) {
    const { nameSet, childNames, parentBoundary } = lookups.get(boundary.name)!;
    const result = boundaryResults.get(boundary.name)!;
    const parentResult = parentBoundary
      ? boundaryResults.get(parentBoundary.name)
      : undefined;

    for (const { from, relation } of relations) {
      classifyRelation(
        nameSet,
        childNames,
        parentBoundary,
        from,
        relation,
        result,
        parentResult,
      );
    }
  }

  return {
    elementsCount: allElements(model).length,
    syncApiCalls: syncApiCalls.length,
    asyncApiCalls: asyncApiCalls.length,
    databases: analyzeDatabases(model),
    boundaries: [...boundaryResults.values()],
  };
};

const analyzeDatabases = (model: Model): DatabasesInfo => {
  const dbNames = new Set(
    allElements(model)
      .filter((it) => it.kind === "ContainerDb")
      .map((it) => it.name),
  );

  let consumes = 0;
  for (const element of allElements(model)) {
    for (const r of element.relations) {
      if (dbNames.has(r.to)) consumes++;
    }
  }

  return {
    count: dbNames.size,
    consumes,
  };
};

export const analyzeArchitecture = (
  model: Model,
  options?: AnalyzeOptions,
): AnalyzedArchitecture => ({
  model,
  report: analyzeModel(model, options),
});

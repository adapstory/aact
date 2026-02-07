import { ArchitectureModel, Boundary, Container, Relation } from "./entities";

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

export interface AnalysisReport {
  elementsCount: number;
  syncApiCalls: number;
  asyncApiCalls: number;
  databases: DatabasesInfo;
  boundaries: BoundaryAnalysis[];
}

export interface AnalyzedArchitecture {
  model: ArchitectureModel;
  report: AnalysisReport;
}

interface DatabasesInfo {
  count: number;
  consumes: number;
}

interface RelationWithSource {
  from: Container;
  relation: Relation;
}

const apiTechnologies = ["http", "grpc", "tcp"];

const allRelations = (model: ArchitectureModel): RelationWithSource[] =>
  model.allContainers.flatMap((container) =>
    container.relations.map((relation) => ({ from: container, relation })),
  );

const boundaryContainsName = (boundary: Boundary, name: string): boolean =>
  boundary.containers.some((c) => c.name === name);

const classifyRelation = (
  boundary: Boundary,
  parentBoundary: Boundary | undefined,
  from: Container,
  relation: Relation,
  result: BoundaryAnalysis,
  parentResult: BoundaryAnalysis | undefined,
): void => {
  if (!boundaryContainsName(boundary, from.name)) return;

  if (boundaryContainsName(boundary, relation.to.name)) {
    result.cohesion++;
    return;
  }

  const isInParentSibling =
    parentBoundary?.boundaries.some((b) =>
      b.containers.some((c) => c.name === relation.to.name),
    ) ?? false;

  if (!parentBoundary || isInParentSibling) {
    result.coupling++;
    result.couplingRelations.push({ from: from.name, to: relation.to.name });
    if (parentResult) parentResult.cohesion++;
  } else if (parentResult) {
    parentResult.coupling++;
    parentResult.couplingRelations.push({
      from: from.name,
      to: relation.to.name,
    });
  }
};

const analyzeModel = (model: ArchitectureModel): AnalysisReport => {
  const relations = allRelations(model);

  const asyncApiCalls = relations.filter((it) =>
    it.relation.tags?.includes("async"),
  );
  const syncApiCalls = relations.filter((it) => {
    const isExternalApi = it.relation.to.type === "System_Ext";
    const isApiTechnology = apiTechnologies.some((apiTechn) =>
      (it.relation.technology ?? "").toLowerCase().includes(apiTechn),
    );
    return (
      !it.relation.tags?.includes("async") && (isExternalApi || isApiTechnology)
    );
  });

  const boundaryResults = new Map<string, BoundaryAnalysis>();
  for (const boundary of model.boundaries) {
    boundaryResults.set(boundary.name, {
      name: boundary.name,
      label: boundary.label,
      cohesion: 0,
      coupling: 0,
      couplingRelations: [],
    });
  }

  for (const boundary of model.boundaries) {
    const parentBoundary = model.boundaries.find((b) =>
      b.boundaries.some((child) => child.name === boundary.name),
    );

    const result = boundaryResults.get(boundary.name)!;
    const parentResult = parentBoundary
      ? boundaryResults.get(parentBoundary.name)
      : undefined;

    for (const { from, relation } of relations) {
      classifyRelation(
        boundary,
        parentBoundary,
        from,
        relation,
        result,
        parentResult,
      );
    }
  }

  return {
    elementsCount: model.allContainers.length,
    syncApiCalls: syncApiCalls.length,
    asyncApiCalls: asyncApiCalls.length,
    databases: analyzeDatabases(model),
    boundaries: [...boundaryResults.values()],
  };
};

const analyzeDatabases = (model: ArchitectureModel): DatabasesInfo => {
  const dbContainers = model.allContainers.filter(
    (it) => it.type === "ContainerDb",
  );

  const dbRelations = model.allContainers.flatMap((container) =>
    container.relations.filter((r) =>
      dbContainers.some((db) => db.name === r.to.name),
    ),
  );

  return {
    count: dbContainers.length,
    consumes: dbRelations.length,
  };
};

export const analyzeArchitecture = (
  model: ArchitectureModel,
): AnalyzedArchitecture => {
  return {
    model,
    report: analyzeModel(model),
  };
};

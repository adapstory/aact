import {
  Stdlib_C4_Boundary,
  Stdlib_C4_Container_Component,
  Stdlib_C4_Dynamic_Rel,
} from "plantuml-parser";

import { loadPlantumlElements } from "./plantuml";
import {
  ArchitectureElements,
  groupElements,
} from "./plantuml/lib/groupElements";

interface AnalyzedArchitecture {
  elements: ArchitectureElements;
  report: AnalysisReport;
}

interface AnalysisReport {
  elementsCount: number;
  syncApiCalls: number;
  asyncApiCalls: number;
  databases: DatabasesInfo;
}

interface DatabasesInfo {
  count: number;
  consumes: number;
}

const apiTechnologies = ["http", "grpc", "tcp"];

const boundaryContainsAlias = (
  boundary: ArchitectureElements["boundaries"][number],
  alias: string,
): boolean =>
  boundary.boundary.elements.some(
    (e) => (e as Stdlib_C4_Container_Component).alias === alias,
  );

const classifyRelation = (
  archBoundary: ArchitectureElements["boundaries"][number],
  parentBoundary: ArchitectureElements["boundaries"][number] | undefined,
  relation: Stdlib_C4_Dynamic_Rel,
): void => {
  if (!boundaryContainsAlias(archBoundary, relation.from)) return;

  if (boundaryContainsAlias(archBoundary, relation.to)) {
    archBoundary.cohesion++;
    return;
  }

  const isInParentSibling =
    parentBoundary?.boundary.elements.some((b) =>
      (b as Stdlib_C4_Boundary).elements?.some(
        (e) => (e as Stdlib_C4_Container_Component).alias === relation.to,
      ),
    ) ?? false;

  if (!parentBoundary || isInParentSibling) {
    archBoundary.couplingRelations.push(relation);
    if (parentBoundary) parentBoundary.cohesion++;
  } else {
    parentBoundary.couplingRelations.push(relation);
  }
};

const analyzeElements = (elements: ArchitectureElements): AnalysisReport => {
  const asyncApiCalls = elements.relations.filter((it) =>
    (it.descr ?? "").includes("async"),
  );
  const syncApiCalls = elements.relations.filter((it) => {
    const component = elements.components.find((ct) => ct.alias === it.to);
    const isExternalApi = (component!.type_.name as string) === "System_Ext";
    const isApiTechnology = apiTechnologies.some((apiTechn) =>
      (it.techn ?? "").toLowerCase().includes(apiTechn),
    );
    return it.descr !== "async" && (isExternalApi || isApiTechnology);
  });

  for (const archBoundary of elements.boundaries) {
    const parentBoundary = elements.boundaries.find((b) =>
      b.boundary.elements.some(
        (e) => (e as Stdlib_C4_Boundary).alias === archBoundary.boundary.alias,
      ),
    );

    for (const relation of elements.relations) {
      classifyRelation(archBoundary, parentBoundary, relation);
    }
  }

  return {
    elementsCount: elements.components.length,
    syncApiCalls: syncApiCalls.length,
    asyncApiCalls: asyncApiCalls.length,
    databases: analyzeDatabases(elements),
  };
};

const analyzeDatabases = (elements: ArchitectureElements): DatabasesInfo => {
  const dbContainers = elements.components.filter(
    (it) => it.type_.name === "ContainerDb",
  );

  const dbRelations = elements.relations.filter((it) =>
    dbContainers.some((ct) => [it.from, it.to].includes(ct.alias)),
  );

  return {
    count: dbContainers.length,
    consumes: dbRelations.length,
  };
};

export const analyzeArchitecture = async (
  filename: string,
): Promise<AnalyzedArchitecture> => {
  const pumlElements = await loadPlantumlElements(filename);
  const groupedElements = groupElements(pumlElements);

  return {
    elements: groupedElements,
    report: analyzeElements(groupedElements),
  };
};

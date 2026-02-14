import path from "node:path";

import type { AactConfig } from "../config";
import { loadPlantumlElements } from "../loaders/plantuml/loadPlantumlElements";
import { mapContainersFromPlantumlElements } from "../loaders/plantuml/mapContainersFromPlantumlElements";
import { loadStructurizrElements } from "../loaders/structurizr/loadStructurizrElements";
import type { ArchitectureModel } from "../model";

export const loadModel = async (
  config: AactConfig,
): Promise<ArchitectureModel> => {
  const resolvedPath = path.resolve(config.source.path);

  switch (config.source.type) {
    case "plantuml": {
      const elements = await loadPlantumlElements(resolvedPath);
      return mapContainersFromPlantumlElements(elements);
    }
    case "structurizr": {
      return loadStructurizrElements(resolvedPath);
    }
    default: {
      const sourceType: never = config.source.type;
      throw new Error(`Unsupported source type: ${String(sourceType)}`);
    }
  }
};

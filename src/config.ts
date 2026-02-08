import type { AclOptions } from "./rules/acl";
import type { CohesionOptions } from "./rules/cohesion";
import type { CrudOptions } from "./rules/crud";
import type { DbPerServiceOptions } from "./rules/dbPerService";

export interface AactConfig {
  source: {
    type: "plantuml" | "structurizr";
    path: string;
  };
  rules?: {
    acl?: boolean | AclOptions;
    acyclic?: boolean;
    crud?: boolean | CrudOptions;
    dbPerService?: boolean | DbPerServiceOptions;
    cohesion?: boolean | CohesionOptions;
  };
  generate?: {
    kubernetes?: {
      path?: string;
    };
    boundaryLabel?: string;
  };
}

export const defineConfig = (config: AactConfig): AactConfig => config;

import type { AclOptions } from "./rules/acl";
import type { ApiGatewayOptions } from "./rules/apiGateway";
import type { CohesionOptions } from "./rules/cohesion";
import type { CrudOptions } from "./rules/crud";
import type { DbPerServiceOptions } from "./rules/dbPerService";
import type { StableDependenciesOptions } from "./rules/stableDependencies";

export interface AactConfig {
  source: {
    type: "plantuml" | "structurizr";
    path: string;
  };
  rules?: {
    acl?: boolean | AclOptions;
    acyclic?: boolean;
    apiGateway?: boolean | ApiGatewayOptions;
    crud?: boolean | CrudOptions;
    dbPerService?: boolean | DbPerServiceOptions;
    cohesion?: boolean | CohesionOptions;
    stableDependencies?: boolean | StableDependenciesOptions;
  };
  generate?: {
    kubernetes?: {
      path?: string;
    };
    boundaryLabel?: string;
  };
}

export const defineConfig = (config: AactConfig): AactConfig => config;

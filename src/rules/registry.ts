import type { ArchitectureModel } from "../model";
import type { FixResult, SourceSyntax } from "./fix";
import type { Violation } from "./types";

import { checkAcl } from "./acl";
import { checkAcyclic } from "./acyclic";
import { checkApiGateway } from "./apiGateway";
import { checkCohesion } from "./cohesion";
import { checkCrud } from "./crud";
import { checkDbPerService } from "./dbPerService";
import { fixAcl } from "./fixAcl";
import { fixDbPerService } from "./fixDbPerService";
import { checkStableDependencies } from "./stableDependencies";

export interface RuleDefinition {
  readonly name: string;
  readonly check: (model: ArchitectureModel, options?: any) => Violation[];
  readonly fix?: (
    model: ArchitectureModel,
    violations: Violation[],
    syntax: SourceSyntax,
    options?: any,
  ) => FixResult[];
}

export const ruleRegistry: readonly RuleDefinition[] = [
  { name: "acl", check: (m, o) => checkAcl(m.allContainers, o), fix: fixAcl },
  { name: "acyclic", check: (m) => checkAcyclic(m.allContainers) },
  { name: "apiGateway", check: (m, o) => checkApiGateway(m.allContainers, o) },
  { name: "crud", check: (m, o) => checkCrud(m.allContainers, o) },
  { name: "dbPerService", check: (m, o) => checkDbPerService(m.allContainers, o), fix: fixDbPerService },
  { name: "cohesion", check: (m, o) => checkCohesion(m, o) },
  { name: "stableDependencies", check: (m, o) => checkStableDependencies(m.allContainers, o) },
];

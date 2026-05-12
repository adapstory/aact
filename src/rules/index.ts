// Public API barrel. Каждое правило — единый RuleDefinition объект
// экспортируемый как xxxRule. Lib helpers (applyEdits etc.) для users-as-library.

export { type AclOptions,aclRule } from "./acl";
export { acyclicRule } from "./acyclic";
export { type ApiGatewayOptions,apiGatewayRule } from "./apiGateway";
export { cohesionRule } from "./cohesion";
export { commonReuseRule } from "./commonReuse";
export { type CrudOptions,crudRule } from "./crud";
export { type DbPerServiceOptions,dbPerServiceRule } from "./dbPerService";
export { applyEdits } from "./lib/applyEdits";
export { ruleRegistry } from "./registry";
export { stableDependenciesRule } from "./stableDependencies";
export * from "./types";

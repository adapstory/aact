// Public API barrel. Каждое правило — единый RuleDefinition объект
// экспортируемый как xxxRule. Lib helpers (applyEdits etc.) для users-as-library.

export { type AclOptions, aclRule } from "./acl";
export { type AcyclicOptions, acyclicRule } from "./acyclic";
export {
  type AdapstoryBffBoundaryOptions,
  adapstoryBffBoundaryRule,
  checkAdapstoryBffBoundary,
} from "./adapstoryBffBoundary";
export {
  type AdapstoryExternalThroughGatewayOrAclOptions,
  adapstoryExternalThroughGatewayOrAclRule,
  checkAdapstoryExternalThroughGatewayOrAcl,
} from "./adapstoryExternalThroughGatewayOrAcl";
export {
  type AdapstoryAiCapabilityGovernanceOptions,
  adapstoryAiCapabilityGovernanceRule,
  type AdapstoryMcpPluginFirstBoundaryOptions,
  adapstoryMcpPluginFirstBoundaryRule,
  type AdapstorySmartLineTenantScopeOptions,
  adapstorySmartLineTenantScopeRule,
  type AdapstoryTenantIsolationEvidenceOptions,
  adapstoryTenantIsolationEvidenceRule,
  type AdapstoryWidgetLakeContractOptions,
  adapstoryWidgetLakeContractRule,
  checkAdapstoryAiCapabilityGovernance,
  checkAdapstoryMcpPluginFirstBoundary,
  checkAdapstorySmartLineTenantScope,
  checkAdapstoryTenantIsolationEvidence,
  checkAdapstoryWidgetLakeContract,
} from "./adapstoryIncubatingRules";
export {
  type AdapstoryNoCoreBcCyclesOptions,
  adapstoryNoCoreBcCyclesRule,
  checkAdapstoryNoCoreBcCycles,
} from "./adapstoryNoCoreBcCycles";
export {
  type AdapstoryPluginCapabilitiesFromManifestOptions,
  adapstoryPluginCapabilitiesFromManifestRule,
  checkAdapstoryPluginCapabilitiesFromManifest,
} from "./adapstoryPluginCapabilitiesFromManifest";
export * from "./adapstoryRulePack";
export {
  type AdapstorySchemaPerBcNotDbPerServiceOptions,
  adapstorySchemaPerBcNotDbPerServiceRule,
  checkAdapstorySchemaPerBcNotDbPerService,
} from "./adapstorySchemaPerBcNotDbPerService";
export { type ApiGatewayOptions, apiGatewayRule } from "./apiGateway";
export { type CohesionOptions, cohesionRule } from "./cohesion";
export { type CommonReuseOptions, commonReuseRule } from "./commonReuse";
export { type CrudOptions, crudRule } from "./crud";
export { type DbPerServiceOptions, dbPerServiceRule } from "./dbPerService";
export {
  applyEdits,
  type ApplyEditsResult,
  type EditConflict,
  editLocation,
} from "./lib/applyEdits";
export { ruleRegistry } from "./registry";
export {
  type StableDependenciesOptions,
  stableDependenciesRule,
} from "./stableDependencies";
export * from "./types";

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
  type AdapstoryEventContractEvidenceOptions,
  adapstoryEventContractEvidenceRule,
  type AdapstoryEvidenceRequirement,
  checkAdapstoryEventContractEvidence,
} from "./adapstoryEventContractEvidence";
export {
  type AdapstoryExternalThroughGatewayOrAclOptions,
  adapstoryExternalThroughGatewayOrAclRule,
  checkAdapstoryExternalThroughGatewayOrAcl,
} from "./adapstoryExternalThroughGatewayOrAcl";
export {
  type AdapstoryFrontendThroughBffOptions,
  adapstoryFrontendThroughBffRule,
  checkAdapstoryFrontendThroughBff,
} from "./adapstoryFrontendThroughBff";
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
  type AdapstoryLlmGatewayBoundaryOptions,
  adapstoryLlmGatewayBoundaryRule,
  checkAdapstoryLlmGatewayBoundary,
} from "./adapstoryLlmGatewayBoundary";
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
export {
  type AdapstoryPolyglotDataBoundaryOptions,
  adapstoryPolyglotDataBoundaryRule,
  checkAdapstoryPolyglotDataBoundary,
} from "./adapstoryPolyglotDataBoundary";
export * from "./adapstoryRulePack";
export {
  type AdapstoryRuntimeEvidenceRequirement,
  type AdapstoryRuntimeObservabilityEvidenceOptions,
  adapstoryRuntimeObservabilityEvidenceRule,
  checkAdapstoryRuntimeObservabilityEvidence,
} from "./adapstoryRuntimeObservabilityEvidence";
export {
  type AdapstorySchemaPerBcNotDbPerServiceOptions,
  adapstorySchemaPerBcNotDbPerServiceRule,
  checkAdapstorySchemaPerBcNotDbPerService,
} from "./adapstorySchemaPerBcNotDbPerService";
export {
  type AdapstoryStatefulEvidenceRequirement,
  type AdapstoryStatefulWorkloadEvidenceOptions,
  adapstoryStatefulWorkloadEvidenceRule,
  checkAdapstoryStatefulWorkloadEvidence,
} from "./adapstoryStatefulWorkloadEvidence";
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

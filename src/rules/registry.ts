import { aclRule } from "./acl";
import { acyclicRule } from "./acyclic";
import { adapstoryBffBoundaryRule } from "./adapstoryBffBoundary";
import { adapstoryExternalThroughGatewayOrAclRule } from "./adapstoryExternalThroughGatewayOrAcl";
import {
  adapstoryAiCapabilityGovernanceRule,
  adapstoryMcpPluginFirstBoundaryRule,
  adapstorySmartLineTenantScopeRule,
  adapstoryTenantIsolationEvidenceRule,
  adapstoryWidgetLakeContractRule,
} from "./adapstoryIncubatingRules";
import { adapstoryNoCoreBcCyclesRule } from "./adapstoryNoCoreBcCycles";
import { adapstoryPluginCapabilitiesFromManifestRule } from "./adapstoryPluginCapabilitiesFromManifest";
import { adapstorySchemaPerBcNotDbPerServiceRule } from "./adapstorySchemaPerBcNotDbPerService";
import { apiGatewayRule } from "./apiGateway";
import { cohesionRule } from "./cohesion";
import { commonReuseRule } from "./commonReuse";
import { crudRule } from "./crud";
import { dbPerServiceRule } from "./dbPerService";
import { stableDependenciesRule } from "./stableDependencies";
import type { RuleDefinition } from "./types";

/**
 * Все built-in правила. Порядок определяет default order CLI вывода.
 * Adding new rule: импорт + строчка в массиве, ничего больше не трогать.
 *
 * `check` / `fix` объявлены как методы в `RuleDefinition` (bivariant под
 * strictFunctionTypes), поэтому typed rules упаковываются в `RuleDefinition[]`
 * без cast'ов. Это тот же контракт что используют customRules.
 */
export const ruleRegistry: readonly RuleDefinition[] = [
  aclRule,
  acyclicRule,
  apiGatewayRule,
  crudRule,
  dbPerServiceRule,
  cohesionRule,
  stableDependenciesRule,
  commonReuseRule,
  adapstoryNoCoreBcCyclesRule,
  adapstoryBffBoundaryRule,
  adapstoryExternalThroughGatewayOrAclRule,
  adapstorySchemaPerBcNotDbPerServiceRule,
  adapstoryPluginCapabilitiesFromManifestRule,
  adapstoryWidgetLakeContractRule,
  adapstorySmartLineTenantScopeRule,
  adapstoryMcpPluginFirstBoundaryRule,
  adapstoryTenantIsolationEvidenceRule,
  adapstoryAiCapabilityGovernanceRule,
];

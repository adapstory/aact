import { aclRule } from "./acl";
import { acyclicRule } from "./acyclic";
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
];

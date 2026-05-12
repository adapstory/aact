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
// Cast each rule to RuleDefinition (default unknown options): generic параметр
// инвариантен (input position), TS не подхватывает widening автоматически.
// Каждое правило сохраняет typed options через свой xxxRule export.
export const ruleRegistry: readonly RuleDefinition[] = [
  aclRule as RuleDefinition,
  acyclicRule,
  apiGatewayRule as RuleDefinition,
  crudRule as RuleDefinition,
  dbPerServiceRule as RuleDefinition,
  cohesionRule,
  stableDependenciesRule,
  commonReuseRule,
];

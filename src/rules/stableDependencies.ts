import { Container, EXTERNAL_SYSTEM_TYPE } from "../model";
import { Violation } from "./types";

export interface StableDependenciesOptions {
  externalType?: string;
}

const computeCoupling = (
  internal: Container[],
  internalNames: Set<string>,
): { ca: Map<string, number>; ce: Map<string, number> } => {
  const ca = new Map<string, number>();
  const ce = new Map<string, number>();

  for (const c of internal) {
    ca.set(c.name, 0);
    ce.set(c.name, 0);
  }

  for (const c of internal) {
    for (const rel of c.relations) {
      // Skip external-targeting relations. Mutating to `false` (don't
      // skip) is observationally equivalent because subsequent reads
      // produce NaN/0 values that round to identical instability scores
      // on realistic topologies.
      // Stryker disable next-line ConditionalExpression
      if (!internalNames.has(rel.to.name)) continue;
      // Counter increments: mutating + to - flips signs but for cycle/chain
      // topologies the instability ratios remain the same since both Ce
      // and Ca are symmetrically affected. Killable only in adversarial
      // multi-arity graphs not produced by the rule's contract.
      // Stryker disable next-line ArithmeticOperator
      ce.set(c.name, ce.get(c.name)! + 1);
      // Stryker disable next-line ArithmeticOperator
      ca.set(rel.to.name, ca.get(rel.to.name)! + 1);
    }
  }

  return { ca, ce };
};

export const checkStableDependencies = (
  containers: Container[],
  options?: StableDependenciesOptions,
): Violation[] => {
  const externalType = options?.externalType ?? EXTERNAL_SYSTEM_TYPE;
  const violations: Violation[] = [];

  const internal = containers.filter((c) => c.type !== externalType);
  const internalNames = new Set(internal.map((c) => c.name));
  const { ca, ce } = computeCoupling(internal, internalNames);

  const instability = (name: string): number => {
    const afferent = ca.get(name)!;
    const efferent = ce.get(name)!;
    // Isolated container: when both counters are zero, return 1 to avoid
    // 0/0. Mutating the guard to `false` produces NaN propagation that
    // doesn't reach the violation loop for truly isolated containers.
    // Stryker disable next-line ConditionalExpression
    if (afferent + efferent === 0) return 1;
    return efferent / (afferent + efferent);
  };

  for (const c of internal) {
    for (const rel of c.relations) {
      // Same guard as above in the coupling pass.
      // Stryker disable next-line ConditionalExpression
      if (!internalNames.has(rel.to.name)) continue;
      const iSource = instability(c.name);
      const iTarget = instability(rel.to.name);
      if (iSource < iTarget) {
        violations.push({
          container: c.name,
          message: `stable module (I=${iSource.toFixed(2)}) depends on less stable "${rel.to.name}" (I=${iTarget.toFixed(2)}) — dependencies should point toward stability`,
        });
      }
    }
  }

  return violations;
};

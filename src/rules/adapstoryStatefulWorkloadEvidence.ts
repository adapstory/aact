import type { Element, Model } from "./adapstoryUtils";
import {
  allElements,
  elementEvidenceText,
  elementOwnText,
  elementViolation,
  matchesConfiguredPattern,
  matchesPattern,
} from "./adapstoryUtils";
import type { RuleDefinition, Violation } from "./types";

export interface AdapstoryStatefulEvidenceRequirement {
  readonly label: string;
  readonly pattern: RegExp;
}

const STATEFUL_SURFACE_PATTERNS = [
  /postgres|postgresql|redis|qdrant|neo4j|minio/i,
  /opensearch|kafka|pvc|statefulset|storageclass/i,
  /database|cache|vector[-_\s]?store|graph[-_\s]?store/i,
  /object[-_\s]?store|event[-_\s]?stream|artifact[-_\s]?repository/i,
];
const ADAPSTORY_STATEFUL_SCOPE_PATTERNS = [
  /adapstory|tenant|bc-?\d+|schema[-_\s]?owner/i,
  /data-plane|vector-store|graph-store|event-stream/i,
  /artifact-repository|platform[-_\s]?data/i,
  /home[-_\s]?data[-_\s]?plane/i,
];
const STATEFUL_REQUIREMENTS: readonly AdapstoryStatefulEvidenceRequirement[] = [
  {
    label: "PVC/storageClass",
    pattern:
      /pvc|storageclass|storage[-_\s]?class|storage[-_\s]?tier|local-path-fast|zfs-|openebs/i,
  },
  {
    label: "backup/restore policy",
    pattern:
      /backup|snapshot|restore|retention|barman|disaster[-_\s]?recovery|\bdr\b/i,
  },
];

export interface AdapstoryStatefulWorkloadEvidenceOptions {
  statefulSurfacePattern?: RegExp;
  adapstoryScopePattern?: RegExp;
  requiredEvidence?: readonly AdapstoryStatefulEvidenceRequirement[];
}

const isStatefulSubject = (
  container: Element,
  statefulSurfacePattern: RegExp | undefined,
  adapstoryScopePattern: RegExp | undefined,
): boolean => {
  const ownText = elementOwnText(container);
  return (
    matchesConfiguredPattern(
      statefulSurfacePattern,
      STATEFUL_SURFACE_PATTERNS,
      ownText,
    ) &&
    matchesConfiguredPattern(
      adapstoryScopePattern,
      ADAPSTORY_STATEFUL_SCOPE_PATTERNS,
      ownText,
    )
  );
};

const missingRequirements = (
  evidence: string,
  requirements: readonly AdapstoryStatefulEvidenceRequirement[],
): string[] =>
  requirements
    .filter((requirement) => !matchesPattern(requirement.pattern, evidence))
    .map((requirement) => requirement.label);

export const checkAdapstoryStatefulWorkloadEvidence = (
  model: Model,
  options?: AdapstoryStatefulWorkloadEvidenceOptions,
): Violation[] => {
  const statefulSurfacePattern = options?.statefulSurfacePattern;
  const adapstoryScopePattern = options?.adapstoryScopePattern;
  const requiredEvidence = options?.requiredEvidence ?? STATEFUL_REQUIREMENTS;
  const violations: Violation[] = [];

  for (const container of allElements(model)) {
    if (
      !isStatefulSubject(
        container,
        statefulSurfacePattern,
        adapstoryScopePattern,
      )
    ) {
      continue;
    }

    const missing = missingRequirements(
      elementEvidenceText(container),
      requiredEvidence,
    );
    if (missing.length === 0) continue;

    violations.push({
      ...elementViolation(
        container,
        `stateful surface "${container.name}" lacks durability evidence: ${missing.join(", ")}`,
      ),
    });
  }

  return violations;
};

export const adapstoryStatefulWorkloadEvidenceRule: RuleDefinition<AdapstoryStatefulWorkloadEvidenceOptions> =
  {
    name: "adapstory-stateful-workload-evidence",
    description:
      "Adapstory stateful surfaces must show PVC/storageClass and backup/restore evidence.",
    adrPath: "ADRs/Adapstory regulation-derived architecture rules.md",
    check: checkAdapstoryStatefulWorkloadEvidence,
  };

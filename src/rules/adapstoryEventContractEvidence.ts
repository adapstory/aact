import type { Element, Model, Relation } from "./adapstoryUtils";
import {
  allElements,
  elementOwnText,
  elementViolation,
  matchesPattern,
  relationEvidenceText,
  targetOf,
} from "./adapstoryUtils";
import type { RuleDefinition, Violation } from "./types";

export interface AdapstoryEvidenceRequirement {
  readonly label: string;
  readonly pattern: RegExp;
}

const EVENT_RELATION_PATTERN =
  /kafka|topic|event|cloudevents?|pub[-_\s]?sub|stream|consumer|producer|cdc|dlt|dlq/i;
const EVENT_CONTRACT_REQUIREMENTS: readonly AdapstoryEvidenceRequirement[] = [
  { label: "CloudEvents 1.0", pattern: /cloudevents?|ce-specversion/i },
  {
    label: "tenant-id header",
    pattern: /tenant[-_]?id|tenantid|X-Tenant-Id|adapstory_tenant_id/i,
  },
  {
    label: "request-initiator header",
    pattern: /request[-_]?initiator|requestInitiator|X-Request-Initiator/i,
  },
  {
    label: "eventversion",
    pattern: /eventversion|event[-_\s]?version|\.v\d+\b|versioned event/i,
  },
];

export interface AdapstoryEventContractEvidenceOptions {
  eventRelationPattern?: RegExp;
  requiredEvidence?: readonly AdapstoryEvidenceRequirement[];
}

const eventEvidenceText = (
  source: Element,
  relation: Relation,
  target: Element | undefined,
): string =>
  [
    elementOwnText(source),
    relationEvidenceText(relation),
    target ? elementOwnText(target) : "",
  ].join(" ");

const missingRequirements = (
  evidence: string,
  requirements: readonly AdapstoryEvidenceRequirement[],
): string[] =>
  requirements
    .filter((requirement) => !matchesPattern(requirement.pattern, evidence))
    .map((requirement) => requirement.label);

export const checkAdapstoryEventContractEvidence = (
  model: Model,
  options?: AdapstoryEventContractEvidenceOptions,
): Violation[] => {
  const eventRelationPattern =
    options?.eventRelationPattern ?? EVENT_RELATION_PATTERN;
  const requiredEvidence =
    options?.requiredEvidence ?? EVENT_CONTRACT_REQUIREMENTS;
  const violations: Violation[] = [];

  for (const container of allElements(model)) {
    for (const relation of container.relations) {
      const target = targetOf(model, relation);
      const relationEvidence = relationEvidenceText(relation);
      if (!matchesPattern(eventRelationPattern, relationEvidence)) continue;

      const evidence = eventEvidenceText(container, relation, target);
      const missing = missingRequirements(evidence, requiredEvidence);
      if (missing.length === 0) continue;

      violations.push({
        ...elementViolation(
          container,
          `event relation "${container.name}" -> "${target?.name ?? relation.to}" lacks evidence: ${missing.join(", ")}`,
          relation,
        ),
      });
    }
  }

  return violations;
};

export const adapstoryEventContractEvidenceRule: RuleDefinition<AdapstoryEventContractEvidenceOptions> =
  {
    name: "adapstory-event-contract-evidence",
    description:
      "Kafka/event relations must carry CloudEvents, tenant, initiator, and version evidence.",
    adrPath: "ADRs/Adapstory regulation-derived architecture rules.md",
    check: checkAdapstoryEventContractEvidence,
  };

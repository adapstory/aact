import type { Model } from "./adapstoryUtils";
import {
  allElements,
  elementOwnText,
  elementViolation,
  matchesPattern,
  relationEvidenceText,
  targetOf,
} from "./adapstoryUtils";
import type { RuleDefinition, Violation } from "./types";

const PYTHON_AI_PATTERN =
  /python|fastapi|ai[-_\s]?service|ml|llm|rag|embedding|inference|recommendation|course[-_\s]?generator|grader|methodist/i;
const POSTGRES_PATTERN =
  /postgres|postgresql|jdbc|sql|transactional[-_\s]?db|shared[-_\s]?database|shared[-_\s]?postgres/i;
const APPROVED_DATA_ACCESS_PATTERN =
  /schema|read[-_\s]?model|cdc|kafka|cloudevents?|event|api|rest|grpc|reviewed/i;

export interface AdapstoryPolyglotDataBoundaryOptions {
  pythonAiPattern?: RegExp;
  postgresPattern?: RegExp;
  approvedDataAccessPattern?: RegExp;
}

export const checkAdapstoryPolyglotDataBoundary = (
  model: Model,
  options?: AdapstoryPolyglotDataBoundaryOptions,
): Violation[] => {
  const pythonAiPattern = options?.pythonAiPattern ?? PYTHON_AI_PATTERN;
  const postgresPattern = options?.postgresPattern ?? POSTGRES_PATTERN;
  const approvedDataAccessPattern =
    options?.approvedDataAccessPattern ?? APPROVED_DATA_ACCESS_PATTERN;
  const violations: Violation[] = [];

  for (const container of allElements(model)) {
    const sourceEvidence = elementOwnText(container);
    if (!matchesPattern(pythonAiPattern, sourceEvidence)) continue;

    for (const relation of container.relations) {
      const target = targetOf(model, relation);
      if (!target) continue;

      const relationEvidence = relationEvidenceText(relation);
      const targetEvidence = elementOwnText(target);
      const evidence = `${relationEvidence} ${targetEvidence}`;
      if (!matchesPattern(postgresPattern, evidence)) continue;
      if (matchesPattern(approvedDataAccessPattern, evidence)) continue;

      violations.push({
        ...elementViolation(
          container,
          `Python/AI service "${container.name}" accesses PostgreSQL "${target.name}" without own-schema/read-model/CDC evidence`,
          relation,
        ),
      });
    }
  }

  return violations;
};

export const adapstoryPolyglotDataBoundaryRule: RuleDefinition<AdapstoryPolyglotDataBoundaryOptions> =
  {
    name: "adapstory-polyglot-data-boundary",
    description:
      "Python AI services must not access PostgreSQL directly without own-schema/read-model/CDC evidence.",
    adrPath: "ADRs/Adapstory regulation-derived architecture rules.md",
    check: checkAdapstoryPolyglotDataBoundary,
  };

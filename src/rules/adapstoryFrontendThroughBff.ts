import type { Element, Model } from "./adapstoryUtils";
import {
  allElements,
  elementOwnText,
  elementViolation,
  matchesConfiguredPattern,
  matchesPattern,
  relationEvidenceText,
  targetOf,
} from "./adapstoryUtils";
import type { RuleDefinition, Violation } from "./types";

const FRONTEND_PATTERNS = [
  /frontend|front-end|browser|spa/i,
  /react|next\.?js|widget/i,
  /client[-_\s]?ui|student[-_\s]?ui|admin[-_\s]?ui|school[-_\s]?ui/i,
  /plugin[-_\s]?ui/i,
];
const BFF_PATTERNS = [
  /bff|web[-_\s]?api/i,
  /backend[-_\s]?for[-_\s]?frontend/i,
  /\/web-api\/adapstory/i,
];
const DIRECT_BACKEND_PATTERNS = [
  /\/api\/bc[-_/]?\d+/i,
  /bc-?\d+|internal[-_\s]?api|domain[-_\s]?api|backend[-_\s]?api/i,
  /plugin|database|data-plane|postgres|redis|qdrant|neo4j|kafka/i,
];
const REVIEWED_EVIDENCE_PATTERN =
  /reviewed[-_\s]?overlay|reviewed overlay|public[-_\s]?asset|static[-_\s]?asset|cdn/i;

export interface AdapstoryFrontendThroughBffOptions {
  frontendPattern?: RegExp;
  bffPattern?: RegExp;
  directBackendPattern?: RegExp;
  reviewedEvidencePattern?: RegExp;
}

const isFrontend = (
  container: Element,
  frontendPattern: RegExp | undefined,
): boolean =>
  matchesConfiguredPattern(
    frontendPattern,
    FRONTEND_PATTERNS,
    elementOwnText(container),
  );

const isBffBoundary = (
  container: Element,
  bffPattern: RegExp | undefined,
): boolean =>
  matchesConfiguredPattern(bffPattern, BFF_PATTERNS, elementOwnText(container));

export const checkAdapstoryFrontendThroughBff = (
  model: Model,
  options?: AdapstoryFrontendThroughBffOptions,
): Violation[] => {
  const frontendPattern = options?.frontendPattern;
  const bffPattern = options?.bffPattern;
  const directBackendPattern = options?.directBackendPattern;
  const reviewedEvidencePattern =
    options?.reviewedEvidencePattern ?? REVIEWED_EVIDENCE_PATTERN;
  const violations: Violation[] = [];

  for (const container of allElements(model)) {
    if (!isFrontend(container, frontendPattern)) continue;
    if (isBffBoundary(container, bffPattern)) continue;

    for (const relation of container.relations) {
      const target = targetOf(model, relation);
      if (!target) continue;

      const relationEvidence = relationEvidenceText(relation);
      const targetEvidence = elementOwnText(target);
      const evidence = `${relationEvidence} ${targetEvidence}`;
      if (matchesPattern(reviewedEvidencePattern, evidence)) continue;
      if (isBffBoundary(target, bffPattern)) continue;
      if (
        !matchesConfiguredPattern(
          directBackendPattern,
          DIRECT_BACKEND_PATTERNS,
          evidence,
        )
      ) {
        continue;
      }

      violations.push({
        ...elementViolation(
          container,
          `frontend "${container.name}" calls "${target.name}" outside BFF/web-api boundary`,
          relation,
        ),
      });
    }
  }

  return violations;
};

export const adapstoryFrontendThroughBffRule: RuleDefinition<AdapstoryFrontendThroughBffOptions> =
  {
    name: "adapstory-frontend-through-bff",
    description:
      "Frontend clients must reach Adapstory backends through the BFF/web-api boundary.",
    adrPath: "ADRs/Adapstory regulation-derived architecture rules.md",
    check: checkAdapstoryFrontendThroughBff,
  };

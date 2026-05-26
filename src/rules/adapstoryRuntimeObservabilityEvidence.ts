import { isDatabaseElement } from "../model";
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

export interface AdapstoryRuntimeEvidenceRequirement {
  readonly label: string;
  readonly pattern: RegExp;
}

const RUNTIME_SURFACE_PATTERN =
  /(^|[\s+_-])(api|bff|service|worker|consumer|producer|gateway|orchestrator|runtime|plugin|agent|job|scheduler)([\s+_-]|$)/i;
const ADAPSTORY_SCOPE_PATTERNS = [
  /adapstory|bc-?\d+|tenant|course|lesson/i,
  /plugin|ai|llm|rag|identity|methodist/i,
  /smart[-_\s]?line|content[-_\s]?repository/i,
  /orchestration|gateway/i,
];
const OBSERVABILITY_REQUIREMENTS: readonly AdapstoryRuntimeEvidenceRequirement[] =
  [
    {
      label: "metrics/ServiceMonitor",
      pattern:
        /\/metrics|prometheus|servicemonitor|http_requests_total|\bup\b/i,
    },
    {
      label: "tracing/correlation",
      pattern:
        /otel|opentelemetry|otlp|trace[_-]?id|correlation[_-]?id|X-Correlation-Id/i,
    },
    {
      label: "structured JSON logs",
      pattern: /structured[-_\s]?log|json[-_\s]?log|log fields|trace_id|loki/i,
    },
  ];

export interface AdapstoryRuntimeObservabilityEvidenceOptions {
  runtimeSurfacePattern?: RegExp;
  adapstoryScopePattern?: RegExp;
  requiredEvidence?: readonly AdapstoryRuntimeEvidenceRequirement[];
}

const isRuntimeSubject = (
  container: Element,
  runtimeSurfacePattern: RegExp,
  adapstoryScopePattern: RegExp | undefined,
): boolean => {
  if (
    container.kind === "Person" ||
    container.external ||
    isDatabaseElement(container)
  ) {
    return false;
  }

  const ownText = elementOwnText(container);
  return (
    matchesPattern(runtimeSurfacePattern, ownText) &&
    matchesConfiguredPattern(
      adapstoryScopePattern,
      ADAPSTORY_SCOPE_PATTERNS,
      ownText,
    )
  );
};

const missingRequirements = (
  evidence: string,
  requirements: readonly AdapstoryRuntimeEvidenceRequirement[],
): string[] =>
  requirements
    .filter((requirement) => !matchesPattern(requirement.pattern, evidence))
    .map((requirement) => requirement.label);

export const checkAdapstoryRuntimeObservabilityEvidence = (
  model: Model,
  options?: AdapstoryRuntimeObservabilityEvidenceOptions,
): Violation[] => {
  const runtimeSurfacePattern =
    options?.runtimeSurfacePattern ?? RUNTIME_SURFACE_PATTERN;
  const adapstoryScopePattern = options?.adapstoryScopePattern;
  const requiredEvidence =
    options?.requiredEvidence ?? OBSERVABILITY_REQUIREMENTS;
  const violations: Violation[] = [];

  for (const container of allElements(model)) {
    if (
      !isRuntimeSubject(container, runtimeSurfacePattern, adapstoryScopePattern)
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
        `runtime surface "${container.name}" lacks observability evidence: ${missing.join(", ")}`,
      ),
    });
  }

  return violations;
};

export const adapstoryRuntimeObservabilityEvidenceRule: RuleDefinition<AdapstoryRuntimeObservabilityEvidenceOptions> =
  {
    name: "adapstory-runtime-observability-evidence",
    description:
      "Adapstory runtime surfaces must expose metrics, tracing/correlation, and structured log evidence.",
    adrPath: "ADRs/Adapstory regulation-derived architecture rules.md",
    check: checkAdapstoryRuntimeObservabilityEvidence,
  };

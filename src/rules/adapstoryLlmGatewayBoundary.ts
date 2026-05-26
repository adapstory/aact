import type { Element, Model } from "./adapstoryUtils";
import {
  allElements,
  elementOwnText,
  elementViolation,
  matchesConfiguredPattern,
  relationEvidenceText,
  targetOf,
} from "./adapstoryUtils";
import type { RuleDefinition, Violation } from "./types";

const AI_CALLER_PATTERNS = [
  /ai|llm|rag|agent|mcp/i,
  /grader|methodist|course[-_\s]?generator/i,
  /personalization|recommendation|embedding|prompt|model/i,
];
const LLM_PROVIDER_PATTERNS = [
  /openai|openrouter|anthropic|gemini/i,
  /google\.generativeai|vertex|bedrock|mistral|cohere/i,
  /ollama|llm[-_\s]?provider|model[-_\s]?provider/i,
  /chat[-_\s]?completion|embeddings?\b/i,
];
const LLM_GATEWAY_PATTERNS = [
  /bc-?10|llm[-_\s]?gateway|ai[-_\s]?gateway/i,
  /model[-_\s]?gateway|capability[-_\s]?boundary/i,
  /capability[-_\s]?gateway|reviewed[-_\s]?overlay|reviewed overlay/i,
];

export interface AdapstoryLlmGatewayBoundaryOptions {
  aiCallerPattern?: RegExp;
  llmProviderPattern?: RegExp;
  llmGatewayPattern?: RegExp;
}

const isGatewayEvidence = (
  value: string,
  llmGatewayPattern: RegExp | undefined,
): boolean =>
  matchesConfiguredPattern(llmGatewayPattern, LLM_GATEWAY_PATTERNS, value);

const isLlmGateway = (
  container: Element,
  llmGatewayPattern: RegExp | undefined,
): boolean => isGatewayEvidence(elementOwnText(container), llmGatewayPattern);

export const checkAdapstoryLlmGatewayBoundary = (
  model: Model,
  options?: AdapstoryLlmGatewayBoundaryOptions,
): Violation[] => {
  const aiCallerPattern = options?.aiCallerPattern;
  const llmProviderPattern = options?.llmProviderPattern;
  const llmGatewayPattern = options?.llmGatewayPattern;
  const violations: Violation[] = [];

  for (const container of allElements(model)) {
    const sourceEvidence = elementOwnText(container);
    if (isLlmGateway(container, llmGatewayPattern)) continue;

    for (const relation of container.relations) {
      const target = targetOf(model, relation);
      if (!target) continue;

      const relationEvidence = relationEvidenceText(relation);
      const targetEvidence = elementOwnText(target);
      const isLlmProviderCall =
        matchesConfiguredPattern(
          llmProviderPattern,
          LLM_PROVIDER_PATTERNS,
          relationEvidence,
        ) ||
        matchesConfiguredPattern(
          llmProviderPattern,
          LLM_PROVIDER_PATTERNS,
          targetEvidence,
        );
      if (!isLlmProviderCall) continue;
      if (isLlmGateway(target, llmGatewayPattern)) continue;
      if (isGatewayEvidence(relationEvidence, llmGatewayPattern)) continue;
      if (
        !matchesConfiguredPattern(
          aiCallerPattern,
          AI_CALLER_PATTERNS,
          sourceEvidence,
        ) &&
        !target.external
      ) {
        continue;
      }

      violations.push({
        ...elementViolation(
          container,
          `LLM/model call "${container.name}" -> "${target.name}" bypasses BC-10 LLM Gateway/capability boundary`,
          relation,
        ),
      });
    }
  }

  return violations;
};

export const adapstoryLlmGatewayBoundaryRule: RuleDefinition<AdapstoryLlmGatewayBoundaryOptions> =
  {
    name: "adapstory-llm-gateway-boundary",
    description:
      "AI and LLM callers must reach OpenAI/OpenRouter/Ollama-style providers through BC-10 LLM Gateway.",
    adrPath: "ADRs/Adapstory regulation-derived architecture rules.md",
    check: checkAdapstoryLlmGatewayBoundary,
  };

import { isDatabaseElement } from "../model";
import type { Element, Model } from "./adapstoryUtils";
import {
  allElements,
  elementOwnText,
  elementText,
  elementViolation,
  matchesPattern,
  relationText,
  targetOf,
} from "./adapstoryUtils";
import type { RuleDefinition, Violation } from "./types";

const WIDGET_SURFACE_PATTERN =
  /widget|sdui|divkit|plugin[-_\s]?ui|ui\.contract/i;
const WIDGET_CONTRACT_PATTERN =
  /widget[-_\s]?lake|ui\.contract[:=]?\s*widget-lake|@adapstory\/ui\/widget-lake|WidgetShell|PluginSurface|DataPanel/i;
const SMART_LINE_PATTERN = /smart[-_\s]?line|SmartLine/i;
const TENANT_EVIDENCE_PATTERN =
  /tenant[_-]?id|tenantId|X-Tenant-Id|adapstory_tenant_id|tenant-scoped|row-level|providerBindings/i;
const MCP_PATTERN =
  /mcp|tools\/list|tools\/call|tool registry|requiredCapabilities|optionalCapabilities|providerBindings/i;
const LEGACY_MCP_PATTERN = /agent\.tools|plugin_tools/i;
const PLUGIN_GATEWAY_PATTERN = /plugin[_-\s]?gateway|gateway/i;
const MANIFEST_OR_REVIEW_PATTERN =
  /manifest|sealed|reviewed[-_\s]?overlay|reviewed overlay/i;
const TENANT_SCOPED_SURFACE_PATTERN =
  /(^|[\s+_-])(api|bff|plugin|agent|ai|data-plane|database|cache|vector-store|graph-store|event-stream)([\s+_-]|$)/i;
const AI_CAPABILITY_PATTERN =
  /(^|[\s+_-])(ai|llm|rag|agent|model|dify|n8n|ollama|whisper|grader|knowledge)([\s+_-]|$)/i;
const AI_CAPABILITY_EXCLUSION_PATTERN = /data[_-\s]?model/i;
const COURSE_GENERATOR_PATTERN = /course[_-\s]?generator/i;
const AI_GOVERNANCE_PATTERN =
  /manifest|reviewed[-_\s]?overlay|reviewed overlay|capability|gateway|plugin|vault|tenant|guardrail|model config|mcp/i;
const DATA_PLANE_TAG_PATTERN =
  /^(data-plane|database|cache|vector-store|graph-store|event-stream|search|artifact-repository)$/i;

export interface AdapstoryWidgetLakeContractOptions {
  surfacePattern?: RegExp;
  contractPattern?: RegExp;
}

export interface AdapstorySmartLineTenantScopeOptions {
  smartLinePattern?: RegExp;
  tenantEvidencePattern?: RegExp;
}

export interface AdapstoryMcpPluginFirstBoundaryOptions {
  mcpPattern?: RegExp;
  legacyMcpPattern?: RegExp;
  pluginGatewayPattern?: RegExp;
  manifestPattern?: RegExp;
}

export interface AdapstoryTenantIsolationEvidenceOptions {
  tenantScopedSurfacePattern?: RegExp;
  tenantEvidencePattern?: RegExp;
}

export interface AdapstoryAiCapabilityGovernanceOptions {
  aiCapabilityPattern?: RegExp;
  governancePattern?: RegExp;
}

const containerOwnText = elementOwnText;
const containerText = elementText;

const hasEvidence = (container: Element, pattern: RegExp): boolean =>
  matchesPattern(pattern, elementText(container));

const isRuntimeEvidenceSubject = (container: Element): boolean => {
  if (
    container.kind === "Person" ||
    container.external ||
    isDatabaseElement(container)
  ) {
    return false;
  }

  return !container.tags.some((tag) =>
    matchesPattern(DATA_PLANE_TAG_PATTERN, tag),
  );
};

const isPluginGateway = (
  container: Element,
  pluginGatewayPattern: RegExp,
): boolean => matchesPattern(pluginGatewayPattern, containerText(container));

export const checkAdapstoryWidgetLakeContract = (
  model: Model,
  options?: AdapstoryWidgetLakeContractOptions,
): Violation[] => {
  const surfacePattern = options?.surfacePattern ?? WIDGET_SURFACE_PATTERN;
  const contractPattern = options?.contractPattern ?? WIDGET_CONTRACT_PATTERN;
  const violations: Violation[] = [];

  for (const container of allElements(model)) {
    if (!matchesPattern(surfacePattern, containerText(container))) continue;
    if (hasEvidence(container, contractPattern)) continue;

    violations.push({
      ...elementViolation(
        container,
        `UI surface "${container.name}" lacks Widget Lake contract evidence`,
      ),
    });
  }

  return violations;
};

export const checkAdapstorySmartLineTenantScope = (
  model: Model,
  options?: AdapstorySmartLineTenantScopeOptions,
): Violation[] => {
  const smartLinePattern = options?.smartLinePattern ?? SMART_LINE_PATTERN;
  const tenantEvidencePattern =
    options?.tenantEvidencePattern ?? TENANT_EVIDENCE_PATTERN;
  const violations: Violation[] = [];

  for (const container of allElements(model)) {
    if (!matchesPattern(smartLinePattern, containerText(container))) {
      continue;
    }
    if (hasEvidence(container, tenantEvidencePattern)) continue;

    violations.push({
      ...elementViolation(
        container,
        `Smart Line surface "${container.name}" lacks tenant-scope evidence`,
      ),
    });
  }

  return violations;
};

export const checkAdapstoryMcpPluginFirstBoundary = (
  model: Model,
  options?: AdapstoryMcpPluginFirstBoundaryOptions,
): Violation[] => {
  const mcpPattern = options?.mcpPattern ?? MCP_PATTERN;
  const legacyMcpPattern = options?.legacyMcpPattern ?? LEGACY_MCP_PATTERN;
  const pluginGatewayPattern =
    options?.pluginGatewayPattern ?? PLUGIN_GATEWAY_PATTERN;
  const manifestPattern =
    options?.manifestPattern ?? MANIFEST_OR_REVIEW_PATTERN;
  const violations: Violation[] = [];

  for (const container of allElements(model)) {
    const text = containerOwnText(container);
    if (matchesPattern(legacyMcpPattern, text)) {
      violations.push({
        ...elementViolation(
          container,
          `MCP surface "${container.name}" declares removed slug-based agent.tools/plugin_tools contract`,
        ),
      });
    } else if (
      matchesPattern(mcpPattern, text) &&
      !isPluginGateway(container, pluginGatewayPattern) &&
      !matchesPattern(manifestPattern, text)
    ) {
      violations.push({
        ...elementViolation(
          container,
          `MCP surface "${container.name}" lacks plugin manifest/reviewed provenance`,
        ),
      });
    }

    for (const relation of container.relations) {
      const target = targetOf(model, relation);
      if (!target) continue;
      const text = relationText(relation);
      if (matchesPattern(legacyMcpPattern, text)) {
        violations.push({
          ...elementViolation(
            container,
            `MCP relation "${container.name}" -> "${target.name}" declares removed slug-based agent.tools/plugin_tools contract`,
            relation,
          ),
        });
        continue;
      }
      if (!matchesPattern(mcpPattern, text)) {
        continue;
      }
      if (
        isPluginGateway(container, pluginGatewayPattern) ||
        isPluginGateway(target, pluginGatewayPattern)
      ) {
        continue;
      }

      violations.push({
        ...elementViolation(
          container,
          `MCP relation "${container.name}" -> "${target.name}" bypasses Plugin Gateway/plugin-first boundary`,
          relation,
        ),
      });
    }
  }

  return violations;
};

export const checkAdapstoryTenantIsolationEvidence = (
  model: Model,
  options?: AdapstoryTenantIsolationEvidenceOptions,
): Violation[] => {
  const tenantScopedSurfacePattern =
    options?.tenantScopedSurfacePattern ?? TENANT_SCOPED_SURFACE_PATTERN;
  const tenantEvidencePattern =
    options?.tenantEvidencePattern ?? TENANT_EVIDENCE_PATTERN;
  const violations: Violation[] = [];

  for (const container of allElements(model)) {
    if (!isRuntimeEvidenceSubject(container)) {
      continue;
    }
    if (!matchesPattern(tenantScopedSurfacePattern, containerText(container))) {
      continue;
    }
    if (hasEvidence(container, tenantEvidencePattern)) continue;

    violations.push({
      ...elementViolation(
        container,
        `tenant-scoped surface "${container.name}" lacks tenant isolation evidence`,
      ),
    });
  }

  return violations;
};

export const checkAdapstoryAiCapabilityGovernance = (
  model: Model,
  options?: AdapstoryAiCapabilityGovernanceOptions,
): Violation[] => {
  const aiCapabilityPattern =
    options?.aiCapabilityPattern ?? AI_CAPABILITY_PATTERN;
  const governancePattern = options?.governancePattern ?? AI_GOVERNANCE_PATTERN;
  const violations: Violation[] = [];

  for (const container of allElements(model)) {
    if (!isRuntimeEvidenceSubject(container)) {
      continue;
    }
    const text = containerOwnText(container);
    if (matchesPattern(AI_CAPABILITY_EXCLUSION_PATTERN, text)) {
      continue;
    }
    if (
      !matchesPattern(aiCapabilityPattern, text) &&
      !matchesPattern(COURSE_GENERATOR_PATTERN, text)
    ) {
      continue;
    }
    if (hasEvidence(container, governancePattern)) continue;

    violations.push({
      ...elementViolation(
        container,
        `AI capability surface "${container.name}" lacks manifest/reviewed governance evidence`,
      ),
    });
  }

  return violations;
};

export const adapstoryWidgetLakeContractRule: RuleDefinition<AdapstoryWidgetLakeContractOptions> =
  {
    name: "adapstory-widget-lake-contract",
    description:
      "Plugin UI and SDUI surfaces must declare a Widget Lake contract.",
    check: checkAdapstoryWidgetLakeContract,
  };

export const adapstorySmartLineTenantScopeRule: RuleDefinition<AdapstorySmartLineTenantScopeOptions> =
  {
    name: "adapstory-smart-line-tenant-scope",
    description:
      "Smart Line components must show explicit tenant-scoped boundaries.",
    check: checkAdapstorySmartLineTenantScope,
  };

export const adapstoryMcpPluginFirstBoundaryRule: RuleDefinition<AdapstoryMcpPluginFirstBoundaryOptions> =
  {
    name: "adapstory-mcp-plugin-first-boundary",
    description:
      "MCP tools and plugin-first calls must resolve through Plugin Gateway and manifest-declared capabilities.",
    check: checkAdapstoryMcpPluginFirstBoundary,
  };

export const adapstoryTenantIsolationEvidenceRule: RuleDefinition<AdapstoryTenantIsolationEvidenceOptions> =
  {
    name: "adapstory-tenant-isolation-evidence",
    description:
      "Tenant-scoped APIs, plugins, data stores, events, and AI surfaces must carry tenant isolation evidence.",
    check: checkAdapstoryTenantIsolationEvidence,
  };

export const adapstoryAiCapabilityGovernanceRule: RuleDefinition<AdapstoryAiCapabilityGovernanceOptions> =
  {
    name: "adapstory-ai-capability-governance",
    description:
      "AI, LLM, RAG, model, Dify, n8n, and agent capability surfaces must be manifest-governed and reviewable.",
    check: checkAdapstoryAiCapabilityGovernance,
  };

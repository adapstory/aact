import type { ArchitectureModel, Container, Relation } from "../model";
import type { Violation } from "./types";

const WIDGET_SURFACE_PATTERN =
    /widget|sdui|divkit|plugin[-_\s]?ui|ui\.contract|frontend_editor_plugin/i;
const WIDGET_CONTRACT_PATTERN =
    /widget[-_\s]?lake|ui\.contract[:=]?\s*widget-lake|@adapstory\/ui\/widget-lake|WidgetShell|PluginSurface|DataPanel/i;
const SMART_LINE_PATTERN = /smart[-_\s]?line|SmartLine/i;
const TENANT_EVIDENCE_PATTERN =
    /tenant[_-]?id|tenantId|X-Tenant-Id|adapstory_tenant_id|tenant-scoped|row-level|plugin_tools/i;
const MCP_PATTERN =
    /mcp|tools\/list|tools\/call|tool registry|agent\.tools|plugin_tools/i;
const PLUGIN_GATEWAY_PATTERN = /plugin[_-\s]?gateway|gateway/i;
const MANIFEST_OR_REVIEW_PATTERN =
    /manifest|sealed|reviewed[-_\s]?overlay|reviewed overlay/i;
const TENANT_SCOPED_SURFACE_PATTERN =
    /(^|[\s+_-])(api|bff|plugin|agent|ai|data-plane|database|cache|vector-store|graph-store|event-stream)([\s+_-]|$)/i;
const AI_CAPABILITY_PATTERN =
    /(^|[\s+_-])(ai|llm|rag|agent|model|dify|n8n|ollama|whisper|grader|knowledge)([\s+_-]|$)/i;
const COURSE_GENERATOR_PATTERN = /course[_-\s]?generator/i;
const AI_GOVERNANCE_PATTERN =
    /manifest|reviewed[-_\s]?overlay|reviewed overlay|capability|gateway|plugin|vault|tenant|guardrail|model config|mcp/i;

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

const matchesPattern = (pattern: RegExp, value: string): boolean => {
    pattern.lastIndex = 0;
    return pattern.test(value);
};

const relationText = (relation: Relation): string =>
    [relation.technology ?? "", ...(relation.tags ?? [])].join(" ");

const containerOwnText = (container: Container): string =>
    [
        container.name,
        container.label,
        container.description,
        ...(container.tags ?? []),
    ].join(" ");

const containerText = (container: Container): string =>
    [
        containerOwnText(container),
        ...container.relations.map(relationText),
    ].join(" ");

const relationContextText = (source: Container, relation: Relation): string =>
    [
        source.name,
        source.label,
        source.description,
        ...(source.tags ?? []),
        relationText(relation),
        relation.to.name,
        relation.to.label,
        relation.to.description,
        ...(relation.to.tags ?? []),
    ].join(" ");

const hasEvidence = (container: Container, pattern: RegExp): boolean =>
    matchesPattern(pattern, containerText(container));

const isPluginGateway = (
    container: Container,
    pluginGatewayPattern: RegExp,
): boolean => matchesPattern(pluginGatewayPattern, containerText(container));

export const checkAdapstoryWidgetLakeContract = (
    model: ArchitectureModel,
    options?: AdapstoryWidgetLakeContractOptions,
): Violation[] => {
    const surfacePattern = options?.surfacePattern ?? WIDGET_SURFACE_PATTERN;
    const contractPattern = options?.contractPattern ?? WIDGET_CONTRACT_PATTERN;
    const violations: Violation[] = [];

    for (const container of model.allContainers) {
        if (!matchesPattern(surfacePattern, containerText(container))) continue;
        if (hasEvidence(container, contractPattern)) continue;

        violations.push({
            container: container.name,
            message: `UI surface "${container.name}" lacks Widget Lake contract evidence`,
        });
    }

    return violations;
};

export const checkAdapstorySmartLineTenantScope = (
    model: ArchitectureModel,
    options?: AdapstorySmartLineTenantScopeOptions,
): Violation[] => {
    const smartLinePattern = options?.smartLinePattern ?? SMART_LINE_PATTERN;
    const tenantEvidencePattern =
        options?.tenantEvidencePattern ?? TENANT_EVIDENCE_PATTERN;
    const violations: Violation[] = [];

    for (const container of model.allContainers) {
        if (!matchesPattern(smartLinePattern, containerText(container))) {
            continue;
        }
        if (hasEvidence(container, tenantEvidencePattern)) continue;

        violations.push({
            container: container.name,
            message: `Smart Line surface "${container.name}" lacks tenant-scope evidence`,
        });
    }

    return violations;
};

export const checkAdapstoryMcpPluginFirstBoundary = (
    model: ArchitectureModel,
    options?: AdapstoryMcpPluginFirstBoundaryOptions,
): Violation[] => {
    const mcpPattern = options?.mcpPattern ?? MCP_PATTERN;
    const pluginGatewayPattern =
        options?.pluginGatewayPattern ?? PLUGIN_GATEWAY_PATTERN;
    const manifestPattern =
        options?.manifestPattern ?? MANIFEST_OR_REVIEW_PATTERN;
    const violations: Violation[] = [];

    for (const container of model.allContainers) {
        const text = containerOwnText(container);
        if (
            matchesPattern(mcpPattern, text) &&
            !isPluginGateway(container, pluginGatewayPattern) &&
            !matchesPattern(manifestPattern, text)
        ) {
            violations.push({
                container: container.name,
                message: `MCP surface "${container.name}" lacks plugin manifest/reviewed provenance`,
            });
        }

        for (const relation of container.relations) {
            if (
                !matchesPattern(
                    mcpPattern,
                    relationContextText(container, relation),
                )
            ) {
                continue;
            }
            if (
                isPluginGateway(container, pluginGatewayPattern) ||
                isPluginGateway(relation.to, pluginGatewayPattern)
            ) {
                continue;
            }

            violations.push({
                container: container.name,
                message: `MCP relation "${container.name}" -> "${relation.to.name}" bypasses Plugin Gateway/plugin-first boundary`,
            });
        }
    }

    return violations;
};

export const checkAdapstoryTenantIsolationEvidence = (
    model: ArchitectureModel,
    options?: AdapstoryTenantIsolationEvidenceOptions,
): Violation[] => {
    const tenantScopedSurfacePattern =
        options?.tenantScopedSurfacePattern ?? TENANT_SCOPED_SURFACE_PATTERN;
    const tenantEvidencePattern =
        options?.tenantEvidencePattern ?? TENANT_EVIDENCE_PATTERN;
    const violations: Violation[] = [];

    for (const container of model.allContainers) {
        if (
            !matchesPattern(
                tenantScopedSurfacePattern,
                containerText(container),
            )
        ) {
            continue;
        }
        if (hasEvidence(container, tenantEvidencePattern)) continue;

        violations.push({
            container: container.name,
            message: `tenant-scoped surface "${container.name}" lacks tenant isolation evidence`,
        });
    }

    return violations;
};

export const checkAdapstoryAiCapabilityGovernance = (
    model: ArchitectureModel,
    options?: AdapstoryAiCapabilityGovernanceOptions,
): Violation[] => {
    const aiCapabilityPattern =
        options?.aiCapabilityPattern ?? AI_CAPABILITY_PATTERN;
    const governancePattern =
        options?.governancePattern ?? AI_GOVERNANCE_PATTERN;
    const violations: Violation[] = [];

    for (const container of model.allContainers) {
        const text = containerText(container);
        if (
            !matchesPattern(aiCapabilityPattern, text) &&
            !matchesPattern(COURSE_GENERATOR_PATTERN, text)
        ) {
            continue;
        }
        if (hasEvidence(container, governancePattern)) continue;

        violations.push({
            container: container.name,
            message: `AI capability surface "${container.name}" lacks manifest/reviewed governance evidence`,
        });
    }

    return violations;
};

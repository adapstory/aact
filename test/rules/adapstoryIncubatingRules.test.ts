import type { ArchitectureModel, Container } from "../../src/model";
import {
    checkAdapstoryAiCapabilityGovernance,
    checkAdapstoryMcpPluginFirstBoundary,
    checkAdapstorySmartLineTenantScope,
    checkAdapstoryTenantIsolationEvidence,
    checkAdapstoryWidgetLakeContract,
} from "../../src/rules";

const container = (
    name: string,
    tags: string[] = [],
    description = "",
    relations: Container["relations"] = [],
): Container => ({
    name,
    label: name,
    type: "Container",
    tags,
    description,
    relations,
});

const model = (containers: Container[]): ArchitectureModel => ({
    boundaries: [],
    allContainers: containers,
});

describe("Adapstory incubating architecture rules", () => {
    it("requires Widget Lake contract evidence for plugin UI surfaces", () => {
        const legacyPluginUi = container(
            "lesson_plugin_ui",
            ["plugin-ui"],
            "Plugin UI surface with local Tailwind widgets.",
        );
        const widgetLakeUi = container(
            "quiz_plugin_ui",
            ["plugin-ui", "widget-lake"],
            "ui.contract: widget-lake-v1; imports @adapstory/ui/widget-lake.",
        );

        expect(
            checkAdapstoryWidgetLakeContract(
                model([legacyPluginUi, widgetLakeUi]),
            ),
        ).toEqual([
            {
                container: "lesson_plugin_ui",
                message:
                    'UI surface "lesson_plugin_ui" lacks Widget Lake contract evidence',
            },
        ]);
    });

    it("requires Smart Line surfaces to carry tenant-scope evidence", () => {
        const smartLine = container(
            "smart_line_orchestrator",
            ["ai-service"],
            "SmartLine render and interact API.",
        );
        const scopedSmartLine = container(
            "smart_line_bff",
            ["bff"],
            "Smart Line API extracts adapstory_tenant_id and forwards X-Tenant-Id.",
        );

        expect(
            checkAdapstorySmartLineTenantScope(
                model([smartLine, scopedSmartLine]),
            ),
        ).toEqual([
            {
                container: "smart_line_orchestrator",
                message:
                    'Smart Line surface "smart_line_orchestrator" lacks tenant-scope evidence',
            },
        ]);
    });

    it("requires MCP tool calls to pass through Plugin Gateway", () => {
        const quizPlugin = container("quiz_plugin", [
            "plugin",
            "source:plugin-manifest",
        ]);
        const pluginGateway = container("plugin_gateway", ["gateway", "bc-02"]);
        const agent = container(
            "agent_runtime",
            ["ai-service"],
            "BC-10 agent runtime.",
            [
                { to: quizPlugin, technology: "MCP tools/call" },
                { to: pluginGateway, technology: "MCP tools/list" },
            ],
        );

        expect(
            checkAdapstoryMcpPluginFirstBoundary(
                model([agent, pluginGateway, quizPlugin]),
            ),
        ).toEqual([
            {
                container: "agent_runtime",
                message:
                    'MCP relation "agent_runtime" -> "quiz_plugin" bypasses Plugin Gateway/plugin-first boundary',
            },
        ]);
    });

    it("requires tenant isolation evidence for tenant-scoped surfaces", () => {
        const contentApi = container("content_repository", ["api", "bc-11"]);
        const pluginGateway = container(
            "plugin_gateway",
            ["gateway", "bc-02"],
            "Validates plugin_tools JWT claim and tenant_id.",
        );

        expect(
            checkAdapstoryTenantIsolationEvidence(
                model([contentApi, pluginGateway]),
            ),
        ).toEqual([
            {
                container: "content_repository",
                message:
                    'tenant-scoped surface "content_repository" lacks tenant isolation evidence',
            },
        ]);
    });

    it("requires AI capability surfaces to declare governance provenance", () => {
        const llmBridge = container(
            "llm_bridge",
            ["ai-service"],
            "Calls external LLM provider.",
        );
        const governedAiGateway = container(
            "ai_capability_gateway",
            ["gateway", "capability-boundary"],
            "Manifest-backed AI capability boundary with model config and guardrails.",
        );

        expect(
            checkAdapstoryAiCapabilityGovernance(
                model([llmBridge, governedAiGateway]),
            ),
        ).toEqual([
            {
                container: "llm_bridge",
                message:
                    'AI capability surface "llm_bridge" lacks manifest/reviewed governance evidence',
            },
        ]);
    });
});

import {
    checkAdapstoryAiCapabilityGovernance,
    checkAdapstoryMcpPluginFirstBoundary,
    checkAdapstorySmartLineTenantScope,
    checkAdapstoryTenantIsolationEvidence,
    checkAdapstoryWidgetLakeContract,
} from "../../src/rules";
import type { TestElement, TestRelation } from "./adapstoryTestModel";
import { testElement, testModel } from "./adapstoryTestModel";

const container = (
    name: string,
    tags: string[] = [],
    description = "",
    relations: TestRelation[] = [],
    type = "Container",
): TestElement => testElement(name, tags, relations, type, description);

const model = (containers: TestElement[]): ReturnType<typeof testModel> =>
    testModel(containers);

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
        ).toMatchObject([
            {
                target: "lesson_plugin_ui",
                targetKind: "element",
                message:
                    'UI surface "lesson_plugin_ui" lacks Widget Lake contract evidence',
            },
        ]);
    });

    it("does not classify the editor plugin package as a Widget Lake surface by name alone", () => {
        const editorPlugin = container("frontend_editor_plugin", [
            "frontend",
            "typescript-frontend",
        ]);

        expect(
            checkAdapstoryWidgetLakeContract(model([editorPlugin])),
        ).toHaveLength(0);
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
        ).toMatchObject([
            {
                target: "smart_line_orchestrator",
                targetKind: "element",
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
        ).toMatchObject([
            {
                target: "agent_runtime",
                targetKind: "element",
                message:
                    'MCP relation "agent_runtime" -> "quiz_plugin" bypasses Plugin Gateway/plugin-first boundary',
            },
        ]);
    });

    it("does not infer MCP bypasses from source or target descriptions alone", () => {
        const redis = container("redis", [], "Cache used by the adapter.");
        const difyAdapter = container(
            "dify_plugin",
            ["source:reviewed-overlay"],
            "Tenant-aware AI Methodist tool registry allowlist.",
            [{ to: redis, technology: "Redis" }],
        );

        expect(
            checkAdapstoryMcpPluginFirstBoundary(model([difyAdapter, redis])),
        ).toHaveLength(0);
    });

    it("rejects removed slug-based MCP contracts even on the gateway", () => {
        const pluginGateway = container(
            "plugin_gateway",
            ["gateway", "source:plugin-manifest"],
            "Resolves agent.tools from the plugin_tools JWT claim.",
        );

        expect(
            checkAdapstoryMcpPluginFirstBoundary(model([pluginGateway])),
        ).toMatchObject([
            {
                target: "plugin_gateway",
                targetKind: "element",
                message:
                    'MCP surface "plugin_gateway" declares removed slug-based agent.tools/plugin_tools contract',
            },
        ]);
    });

    it("requires tenant isolation evidence for tenant-scoped surfaces", () => {
        const contentApi = container("content_repository", ["api", "bc-11"]);
        const pluginGateway = container(
            "plugin_gateway",
            ["gateway", "bc-02"],
            "Validates exact providerBindings grant and tenant_id.",
        );

        expect(
            checkAdapstoryTenantIsolationEvidence(
                model([contentApi, pluginGateway]),
            ),
        ).toMatchObject([
            {
                target: "content_repository",
                targetKind: "element",
                message:
                    'tenant-scoped surface "content_repository" lacks tenant isolation evidence',
            },
        ]);
    });

    it("does not accept removed plugin_tools claims as tenant evidence", () => {
        const legacyGateway = container(
            "plugin_gateway",
            ["gateway", "bc-02"],
            "Validates plugin_tools JWT claim.",
        );

        expect(
            checkAdapstoryTenantIsolationEvidence(model([legacyGateway])),
        ).toMatchObject([
            {
                target: "plugin_gateway",
                targetKind: "element",
                message:
                    'tenant-scoped surface "plugin_gateway" lacks tenant isolation evidence',
            },
        ]);
    });

    it("does not ask tenant-isolation evidence from people, externals, data-plane, or artifact repositories", () => {
        const student = container(
            "student",
            [],
            "Uses AI-native learning surfaces.",
            [],
            "Person",
        );
        const telegram = container(
            "telegram",
            ["External"],
            "Telegram Bot API.",
            [],
            "System_Ext",
        );
        const postgres = container(
            "postgres",
            ["data-plane", "database"],
            "PostgreSQL data-plane.",
            [],
            "ContainerDb",
        );
        const nexus = container(
            "nexus",
            ["artifact-repository"],
            "Maven and dependency cache repository.",
        );

        expect(
            checkAdapstoryTenantIsolationEvidence(
                model([student, telegram, postgres, nexus]),
            ),
        ).toHaveLength(0);
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
        ).toMatchObject([
            {
                target: "llm_bridge",
                targetKind: "element",
                message:
                    'AI capability surface "llm_bridge" lacks manifest/reviewed governance evidence',
            },
        ]);
    });

    it("does not classify people or data-model services as AI governance surfaces by wording alone", () => {
        const student = container(
            "student",
            [],
            "Uses AI-native learning surfaces.",
            [],
            "Person",
        );
        const dataModel = container("data_model_engine", [
            "api",
            "bc-15",
            "java-service",
        ]);

        expect(
            checkAdapstoryAiCapabilityGovernance(model([student, dataModel])),
        ).toHaveLength(0);
    });
});

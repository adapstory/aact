import { checkAdapstoryBffBoundary } from "../../src/rules";
import type { TestElement, TestRelation } from "./adapstoryTestModel";
import { testElement, testModel } from "./adapstoryTestModel";

const container = (
    name: string,
    tags: string[] = [],
    relations: TestRelation[] = [],
    type = "Container",
): TestElement => testElement(name, tags, relations, type);

const model = (containers: TestElement[]): ReturnType<typeof testModel> =>
    testModel(containers);

describe("checkAdapstoryBffBoundary", () => {
    it("allows BFF calls to approved BC APIs, gateways, and explicit auth targets", () => {
        const dataModelEngine = container("data_model_engine", [
            "api",
            "bc-15",
        ]);
        const pluginGateway = container("plugin_gateway", ["gateway", "bc-02"]);
        const capabilityApi = container("agent_studio", [
            "capability-boundary",
            "plugin",
            "python-plugin-service",
        ]);
        const keycloak = container("keycloak_service", []);
        const bff = container(
            "bff_student",
            ["bff", "java-bff"],
            [
                { to: dataModelEngine },
                { to: pluginGateway },
                { to: capabilityApi },
                { to: keycloak },
            ],
        );

        expect(
            checkAdapstoryBffBoundary(
                model([
                    bff,
                    dataModelEngine,
                    pluginGateway,
                    capabilityApi,
                    keycloak,
                ]),
            ),
        ).toHaveLength(0);
    });

    it("rejects direct BFF calls to plugin internals", () => {
        const plugin = container("ai_course_generator", [
            "plugin",
            "python-plugin-service",
        ]);
        const bff = container("bff_school", ["bff"], [{ to: plugin }]);

        expect(checkAdapstoryBffBoundary(model([bff, plugin]))).toMatchObject([
            {
                target: "bff_school",
                targetKind: "element",
                message:
                    'BFF "bff_school" calls plugin internal "ai_course_generator" directly; use plugin gateway/capability API',
            },
        ]);
    });

    it("allows BFF calls to approved BC APIs even when the runtime is plugin-hosted", () => {
        const aiOrchestration = container("ai_orchestration", [
            "capability-boundary",
            "plugin",
            "python-plugin-service",
        ]);
        const bff = container("bff_school", ["bff"], [{ to: aiOrchestration }]);

        expect(
            checkAdapstoryBffBoundary(model([bff, aiOrchestration])),
        ).toHaveLength(0);
    });

    it("rejects direct BFF calls to plugin-named internals without plugin tags", () => {
        const plugin = container("dify_plugin", ["repository"]);
        const bff = container("bff_school", ["bff"], [{ to: plugin }]);

        expect(checkAdapstoryBffBoundary(model([bff, plugin]))).toMatchObject([
            {
                target: "bff_school",
                targetKind: "element",
                message:
                    'BFF "bff_school" calls plugin internal "dify_plugin" directly; use plugin gateway/capability API',
            },
        ]);
    });

    it("rejects direct BFF calls to infrastructure and random services", () => {
        const redis = container("redis", [], [], "ContainerDb");
        const random = container("workflow_engine", ["java-service"]);
        const bff = container(
            "bff_admin",
            ["bff"],
            [{ to: redis }, { to: random }],
        );

        expect(
            checkAdapstoryBffBoundary(model([bff, redis, random])),
        ).toMatchObject([
            {
                target: "bff_admin",
                targetKind: "element",
                message:
                    'BFF "bff_admin" calls non-approved target "redis"; target must be allowed BC/API/gateway',
            },
            {
                target: "bff_admin",
                targetKind: "element",
                message:
                    'BFF "bff_admin" calls non-approved target "workflow_engine"; target must be allowed BC/API/gateway',
            },
        ]);
    });

    it("allows BFF Redis only with reviewed session-cache policy evidence", () => {
        const redis = container("redis", [], [], "ContainerDb");
        const bff = container(
            "bff_admin",
            ["bff"],
            [
                {
                    to: redis,
                    technology: "Redis distributed OAuth session store",
                    tags: [
                        "reviewed-overlay",
                        "cache-policy:bff-session-store",
                        "tenant-scoped",
                    ],
                },
            ],
        );

        expect(checkAdapstoryBffBoundary(model([bff, redis]))).toHaveLength(0);
    });

    it("supports custom allowed BC tags and target names", () => {
        const billing = container("billing_api", ["api", "domain-billing"]);
        const legacyAuth = container("legacy_auth", []);
        const bff = container(
            "billing_bff",
            ["edge-bff"],
            [{ to: billing }, { to: legacyAuth }],
        );

        expect(
            checkAdapstoryBffBoundary(model([bff, billing, legacyAuth]), {
                bffTagPattern: /edge-bff/i,
                allowedBcTags: ["domain-billing"],
                allowedTargetNamePattern: /^legacy_auth$/,
            }),
        ).toHaveLength(0);
    });

    it("ignores non-BFF containers", () => {
        const redis = container("redis", [], [], "ContainerDb");
        const service = container(
            "content_repository",
            ["api", "bc-11"],
            [{ to: redis }],
        );

        expect(checkAdapstoryBffBoundary(model([service, redis]))).toHaveLength(
            0,
        );
    });
});

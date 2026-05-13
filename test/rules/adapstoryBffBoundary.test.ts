import type { ArchitectureModel, Container } from "../../src/model";
import { checkAdapstoryBffBoundary } from "../../src/rules";

const container = (
    name: string,
    tags: string[] = [],
    relations: Container["relations"] = [],
    type = "Container",
): Container => ({
    name,
    label: name,
    type,
    tags,
    description: "",
    relations,
});

const model = (containers: Container[]): ArchitectureModel => ({
    boundaries: [],
    allContainers: containers,
});

describe("checkAdapstoryBffBoundary", () => {
    it("allows BFF calls to approved BC APIs, gateways, and explicit auth targets", () => {
        const dataModelEngine = container("data_model_engine", [
            "api",
            "bc-15",
        ]);
        const pluginGateway = container("plugin_gateway", ["gateway", "bc-02"]);
        const keycloak = container("keycloak_service", []);
        const bff = container(
            "bff_student",
            ["bff", "java-bff"],
            [{ to: dataModelEngine }, { to: pluginGateway }, { to: keycloak }],
        );

        expect(
            checkAdapstoryBffBoundary(
                model([bff, dataModelEngine, pluginGateway, keycloak]),
            ),
        ).toHaveLength(0);
    });

    it("rejects direct BFF calls to plugin internals", () => {
        const plugin = container("ai_course_generator", [
            "plugin",
            "python-plugin-service",
        ]);
        const bff = container("bff_school", ["bff"], [{ to: plugin }]);

        expect(checkAdapstoryBffBoundary(model([bff, plugin]))).toEqual([
            {
                container: "bff_school",
                message:
                    'BFF "bff_school" calls plugin internal "ai_course_generator" directly; use plugin gateway/capability API',
            },
        ]);
    });

    it("rejects direct BFF calls to plugin-named internals without plugin tags", () => {
        const plugin = container("dify_plugin", ["repository"]);
        const bff = container("bff_school", ["bff"], [{ to: plugin }]);

        expect(checkAdapstoryBffBoundary(model([bff, plugin]))).toEqual([
            {
                container: "bff_school",
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

        expect(checkAdapstoryBffBoundary(model([bff, redis, random]))).toEqual([
            {
                container: "bff_admin",
                message:
                    'BFF "bff_admin" calls non-approved target "redis"; target must be allowed BC/API/gateway',
            },
            {
                container: "bff_admin",
                message:
                    'BFF "bff_admin" calls non-approved target "workflow_engine"; target must be allowed BC/API/gateway',
            },
        ]);
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

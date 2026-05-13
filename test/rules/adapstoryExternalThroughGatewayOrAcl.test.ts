import type { ArchitectureModel, Container } from "../../src/model";
import { checkAdapstoryExternalThroughGatewayOrAcl } from "../../src/rules";

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

const external = (name: string): Container =>
    container(name, [], [], "System_Ext");

const model = (containers: Container[]): ArchitectureModel => ({
    boundaries: [],
    allContainers: containers,
});

describe("checkAdapstoryExternalThroughGatewayOrAcl", () => {
    it("rejects direct calls to external APIs from ordinary containers", () => {
        const telegram = external("telegram");
        const plugin = container(
            "telegram_channel_plugin",
            ["plugin"],
            [{ to: telegram, technology: "Telegram Bot API" }],
        );

        expect(
            checkAdapstoryExternalThroughGatewayOrAcl(
                model([plugin, telegram]),
            ),
        ).toEqual([
            {
                container: "telegram_channel_plugin",
                message:
                    'calls external "telegram" without gateway/ACL/capability boundary',
            },
        ]);
    });

    it("allows gateway, ACL, and capability boundary containers", () => {
        const llm = external("llm_api");
        const dify = external("dify");
        const n8n = external("n8n");
        const gateway = container("plugin_gateway", ["gateway"], [{ to: llm }]);
        const acl = container("dify_acl", ["acl"], [{ to: dify }]);
        const capability = container(
            "n8n_connector",
            ["capability-boundary"],
            [{ to: n8n }],
        );

        expect(
            checkAdapstoryExternalThroughGatewayOrAcl(
                model([gateway, acl, capability, llm, dify, n8n]),
            ),
        ).toHaveLength(0);
    });

    it("allows explicit boundary names when tags are missing", () => {
        const externalApi = external("payments_api");
        const gatewayByName = container(
            "payments_gateway",
            [],
            [{ to: externalApi }],
        );

        expect(
            checkAdapstoryExternalThroughGatewayOrAcl(
                model([gatewayByName, externalApi]),
            ),
        ).toHaveLength(0);
    });

    it("supports custom external type and boundary tags", () => {
        const legacyApi = container("legacy_api", [], [], "Legacy_System");
        const adapter = container(
            "legacy_adapter",
            ["adapter"],
            [{ to: legacyApi }],
        );

        expect(
            checkAdapstoryExternalThroughGatewayOrAcl(
                model([adapter, legacyApi]),
                {
                    externalType: "Legacy_System",
                    boundaryTags: ["adapter"],
                    boundaryNamePattern: /never-matches/i,
                },
            ),
        ).toHaveLength(0);

        expect(
            checkAdapstoryExternalThroughGatewayOrAcl(
                model([adapter, legacyApi]),
                {
                    externalType: "Legacy_System",
                    boundaryTags: ["gateway"],
                    boundaryNamePattern: /never-matches/i,
                },
            ),
        ).toHaveLength(1);
    });
});

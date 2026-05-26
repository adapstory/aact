import { checkAdapstoryExternalThroughGatewayOrAcl } from "../../src/rules";
import type { TestElement, TestRelation } from "./adapstoryTestModel";
import { testElement, testModel } from "./adapstoryTestModel";

const container = (
  name: string,
  tags: string[] = [],
  relations: TestRelation[] = [],
  type = "Container",
): TestElement => testElement(name, tags, relations, type);

const external = (name: string): TestElement =>
  container(name, [], [], "System_Ext");

const model = (containers: TestElement[]): ReturnType<typeof testModel> =>
  testModel(containers);

describe("checkAdapstoryExternalThroughGatewayOrAcl", () => {
  it("rejects direct calls to external APIs from ordinary containers", () => {
    const telegram = external("telegram");
    const plugin = container(
      "telegram_channel_plugin",
      ["plugin"],
      [{ to: telegram, technology: "Telegram Bot API" }],
    );

    expect(
      checkAdapstoryExternalThroughGatewayOrAcl(model([plugin, telegram])),
    ).toMatchObject([
      {
        target: "telegram_channel_plugin",
        targetKind: "element",
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

  it("supports custom boundary tags", () => {
    const legacyApi = external("legacy_api");
    const adapter = container(
      "legacy_adapter",
      ["adapter"],
      [{ to: legacyApi }],
    );

    expect(
      checkAdapstoryExternalThroughGatewayOrAcl(model([adapter, legacyApi]), {
        boundaryTags: ["adapter"],
        boundaryNamePattern: /never-matches/i,
      }),
    ).toHaveLength(0);

    expect(
      checkAdapstoryExternalThroughGatewayOrAcl(model([adapter, legacyApi]), {
        boundaryTags: ["gateway"],
        boundaryNamePattern: /never-matches/i,
      }),
    ).toHaveLength(1);
  });
});

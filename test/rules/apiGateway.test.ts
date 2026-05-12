import { apiGatewayRule } from "../../src/rules";
import { makeModel } from "../helpers/makeModel";

describe("apiGatewayRule.check", () => {
  it("returns no violations when ACL routes through gateway", () => {
    const model = makeModel({
      containers: [
        {
          name: "acl",
          tags: ["acl"],
          relations: [{ to: "ext", technology: "HTTPS via API Gateway" }],
        },
        { name: "ext", kind: "System", external: true },
      ],
    });
    expect(apiGatewayRule.check(model)).toHaveLength(0);
  });

  it("violates when ACL bypasses gateway", () => {
    const model = makeModel({
      containers: [
        {
          name: "acl",
          tags: ["acl"],
          relations: [{ to: "ext", technology: "raw HTTP" }],
        },
        { name: "ext", kind: "System", external: true },
      ],
    });
    const v = apiGatewayRule.check(model);
    expect(v).toHaveLength(1);
    expect(v[0].message).toMatch(/gateway/i);
  });

  it("non-ACL containers are not checked", () => {
    const model = makeModel({
      containers: [
        { name: "svc", relations: [{ to: "ext", technology: "raw" }] },
        { name: "ext", kind: "System", external: true },
      ],
    });
    expect(apiGatewayRule.check(model)).toHaveLength(0);
  });

  it("non-external targets are not checked", () => {
    const model = makeModel({
      containers: [
        {
          name: "acl",
          tags: ["acl"],
          relations: [{ to: "internal", technology: "raw" }],
        },
        { name: "internal" },
      ],
    });
    expect(apiGatewayRule.check(model)).toHaveLength(0);
  });

  it("respects custom gatewayPattern", () => {
    const model = makeModel({
      containers: [
        {
          name: "acl",
          tags: ["acl"],
          relations: [{ to: "ext", technology: "via custom-proxy" }],
        },
        { name: "ext", kind: "System", external: true },
      ],
    });
    expect(
      apiGatewayRule.check(model, { gatewayPattern: /custom-proxy/i }),
    ).toHaveLength(0);
  });
});

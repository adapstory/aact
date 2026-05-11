import { fc, test } from "@fast-check/vitest";

import {
  Container,
  CONTAINER_TYPE,
  EXTERNAL_SYSTEM_TYPE,
} from "../../src/model";
import { checkApiGateway } from "../../src/rules";

const tagArb = fc
  .string({ minLength: 2, maxLength: 8 })
  .filter((s) => /^[a-z][a-z0-9_]*$/.test(s));

const makeContainer = (
  over: Partial<Container> & Pick<Container, "name">,
): Container => ({
  label: over.name,
  type: CONTAINER_TYPE,
  description: "",
  relations: [],
  ...over,
});

describe("checkApiGateway", () => {
  const externalSystem: Container = {
    name: "ext_system",
    label: "External System",
    type: "System_Ext",
    description: "",
    relations: [],
  };

  it("returns no violations when technology matches gateway pattern", () => {
    const containers: Container[] = [
      {
        name: "my_acl",
        label: "My ACL",
        type: "Container",
        tags: ["acl"],
        description: "",
        relations: [
          {
            to: externalSystem,
            technology: "https://gateway.int.com:443/api/v1",
          },
        ],
      },
      externalSystem,
    ];

    expect(checkApiGateway(containers)).toHaveLength(0);
  });

  it("returns violation when technology does not match gateway pattern", () => {
    const containers: Container[] = [
      {
        name: "my_acl",
        label: "My ACL",
        type: "Container",
        tags: ["acl"],
        description: "",
        relations: [
          { to: externalSystem, technology: "https://direct.api.com/v1" },
        ],
      },
      externalSystem,
    ];

    const violations = checkApiGateway(containers);
    expect(violations).toHaveLength(1);
    expect(violations[0].container).toBe("my_acl");
    expect(violations[0].message).toContain("ext_system");
  });

  it("returns no violations without external relations", () => {
    const db: Container = {
      name: "my_db",
      label: "My DB",
      type: "ContainerDb",
      description: "",
      relations: [],
    };
    const containers: Container[] = [
      {
        name: "my_acl",
        label: "My ACL",
        type: "Container",
        tags: ["acl"],
        description: "",
        relations: [{ to: db }],
      },
      db,
    ];

    expect(checkApiGateway(containers)).toHaveLength(0);
  });

  it("supports custom options", () => {
    const legacy: Container = {
      name: "legacy",
      label: "Legacy",
      type: "Legacy_System",
      description: "",
      relations: [],
    };
    const containers: Container[] = [
      {
        name: "adapter",
        label: "Adapter",
        type: "Container",
        tags: ["adapter"],
        description: "",
        relations: [{ to: legacy, technology: "https://proxy.internal/api" }],
      },
      legacy,
    ];

    expect(
      checkApiGateway(containers, {
        aclTag: "adapter",
        externalType: "Legacy_System",
        gatewayPattern: /proxy/i,
      }),
    ).toHaveLength(0);

    expect(
      checkApiGateway(containers, {
        aclTag: "adapter",
        externalType: "Legacy_System",
        gatewayPattern: /gateway/i,
      }),
    ).toHaveLength(1);
  });

  it("falls back to empty array when technology is undefined (covers ?? [])", () => {
    // Stryker mutated `rel.technology?.split(", ") ?? []` to use a sentinel
    // array. With sentinel, the empty path would inject junk into the techs
    // collection and possibly produce false positives. Pin: undefined tech
    // produces a violation referencing the external system.
    const containers: Container[] = [
      {
        name: "my_acl",
        label: "My ACL",
        type: "Container",
        tags: ["acl"],
        description: "",
        relations: [{ to: externalSystem /* no technology */ }],
      },
      externalSystem,
    ];
    const violations = checkApiGateway(containers);
    expect(violations).toHaveLength(1);
    expect(violations[0].container).toBe("my_acl");
    expect(violations[0].message).toContain("ext_system");
  });

  it("fires when relation has no technology field at all (covers `?? []` branch)", () => {
    const containers: Container[] = [
      {
        name: "my_acl",
        label: "My ACL",
        type: "Container",
        tags: ["acl"],
        description: "",
        // technology omitted → split returns [], no item passes gateway pattern → violation
        relations: [{ to: externalSystem }],
      },
      externalSystem,
    ];
    const violations = checkApiGateway(containers);
    expect(violations).toHaveLength(1);
  });

  it("checks each external relation independently", () => {
    const ext1: Container = {
      name: "ext1",
      label: "Ext 1",
      type: "System_Ext",
      description: "",
      relations: [],
    };
    const ext2: Container = {
      name: "ext2",
      label: "Ext 2",
      type: "System_Ext",
      description: "",
      relations: [],
    };
    const containers: Container[] = [
      {
        name: "my_acl",
        label: "My ACL",
        type: "Container",
        tags: ["acl"],
        description: "",
        relations: [
          { to: ext1, technology: "https://gateway.int.com/v1" },
          { to: ext2, technology: "https://direct.api.com/v1" },
        ],
      },
      ext1,
      ext2,
    ];

    const violations = checkApiGateway(containers);
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain("ext2");
  });

  // Property-based: aclTag and gatewayPattern options must drive behavior,
  // never the default literals.
  test.prop([tagArb])(
    "ACL container calling external without gateway in technology fires",
    (customAclTag) => {
      const ext = makeContainer({ name: "ext", type: EXTERNAL_SYSTEM_TYPE });
      const acl = makeContainer({
        name: "acl",
        tags: [customAclTag],
        relations: [{ to: ext, technology: "REST" }],
      });
      const violations = checkApiGateway([acl, ext], { aclTag: customAclTag });
      expect(violations).toHaveLength(1);
      expect(violations[0].container).toBe("acl");
    },
  );

  test.prop([tagArb])(
    "ACL container calling external WITH gateway in technology never fires",
    (customAclTag) => {
      const ext = makeContainer({ name: "ext", type: EXTERNAL_SYSTEM_TYPE });
      const acl = makeContainer({
        name: "acl",
        tags: [customAclTag],
        relations: [{ to: ext, technology: "https://gateway.example.com" }],
      });
      expect(
        checkApiGateway([acl, ext], { aclTag: customAclTag }),
      ).toHaveLength(0);
    },
  );

  test.prop([fc.constantFrom("api", "router", "broker")])(
    "custom gatewayPattern is honored for the gateway-detection check",
    (gatewayWord) => {
      const ext = makeContainer({ name: "ext", type: EXTERNAL_SYSTEM_TYPE });
      const acl = makeContainer({
        name: "acl",
        tags: ["acl"],
        relations: [
          { to: ext, technology: `https://${gatewayWord}.example.com` },
        ],
      });
      const pattern = new RegExp(gatewayWord, "i");
      expect(
        checkApiGateway([acl, ext], { gatewayPattern: pattern }),
      ).toHaveLength(0);
    },
  );
});

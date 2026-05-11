import { fc, test } from "@fast-check/vitest";

import { Container, CONTAINER_TYPE } from "../../src/model";
import { checkAcl } from "../../src/rules";

const tagArb = fc
  .string({ minLength: 2, maxLength: 8 })
  .filter((s) => /^[a-z][a-z0-9_]*$/.test(s));

const typeArb = fc
  .string({ minLength: 3, maxLength: 12 })
  .filter((s) => /^[A-Z][a-zA-Z_]*$/.test(s));

const makeContainer = (
  over: Partial<Container> & Pick<Container, "name">,
): Container => ({
  label: over.name,
  type: CONTAINER_TYPE,
  description: "",
  relations: [],
  ...over,
});

describe("checkAcl", () => {
  const externalSystem: Container = {
    name: "ext_system",
    label: "External System",
    type: "System_Ext",
    description: "",
    relations: [],
  };

  it("returns no violations when acl-tagged container depends on external", () => {
    const containers: Container[] = [
      {
        name: "my_acl",
        label: "My ACL",
        type: "Container",
        tags: ["acl"],
        description: "",
        relations: [{ to: externalSystem }],
      },
      externalSystem,
    ];

    expect(checkAcl(containers)).toHaveLength(0);
  });

  it("returns violation when non-acl container depends on external", () => {
    const containers: Container[] = [
      {
        name: "my_service",
        label: "My Service",
        type: "Container",
        description: "",
        relations: [{ to: externalSystem }],
      },
      externalSystem,
    ];

    const violations = checkAcl(containers);
    expect(violations).toHaveLength(1);
    expect(violations[0].container).toBe("my_service");
  });

  it("returns no violations when no external dependencies", () => {
    const db: Container = {
      name: "my_db",
      label: "My DB",
      type: "ContainerDb",
      description: "",
      relations: [],
    };
    const containers: Container[] = [
      {
        name: "my_service",
        label: "My Service",
        type: "Container",
        description: "",
        relations: [{ to: db }],
      },
      db,
    ];

    expect(checkAcl(containers)).toHaveLength(0);
  });

  it("returns no violations for empty list", () => {
    expect(checkAcl([])).toHaveLength(0);
  });

  it("violation message uses singular 'system' for one external dependency", () => {
    const svc: Container = {
      name: "single",
      label: "Single",
      type: "Container",
      description: "",
      relations: [{ to: externalSystem }],
    };
    const violations = checkAcl([svc, externalSystem]);
    expect(violations[0].message).toContain("external system ext_system");
    expect(violations[0].message).not.toMatch(/external systems/);
    expect(violations[0].message).toContain("without an ACL layer");
  });

  it("violation message uses plural 'systems' for multiple externals", () => {
    const ext2: Container = {
      name: "ext_b",
      label: "Ext B",
      type: "System_Ext",
      description: "",
      relations: [],
    };
    const svc: Container = {
      name: "multi",
      label: "Multi",
      type: "Container",
      description: "",
      relations: [{ to: externalSystem }, { to: ext2 }],
    };
    const violations = checkAcl([svc, externalSystem, ext2]);
    expect(violations[0].message).toContain("external systems");
    expect(violations[0].message).toContain("ext_system, ext_b");
    expect(violations[0].message).toContain("without an ACL layer");
  });

  it("violation message lists all external dependencies", () => {
    const ext2: Container = {
      name: "ext_payments",
      label: "External Payments",
      type: "System_Ext",
      description: "",
      relations: [],
    };
    const svc: Container = {
      name: "my_service",
      label: "My Service",
      type: "Container",
      description: "",
      relations: [{ to: externalSystem }, { to: ext2 }],
    };

    const violations = checkAcl([svc, externalSystem, ext2]);
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain("ext_system");
    expect(violations[0].message).toContain("ext_payments");
  });

  it("supports custom tag and externalType options", () => {
    const customExt: Container = {
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
        tags: ["gateway"],
        description: "",
        relations: [{ to: customExt }],
      },
      customExt,
    ];

    expect(
      checkAcl(containers, { tag: "gateway", externalType: "Legacy_System" }),
    ).toHaveLength(0);

    expect(
      checkAcl(containers, { externalType: "Legacy_System" }),
    ).toHaveLength(1);
  });

  // Property-based: option-bearing branches must read the option, not literals.
  // The class of bugs we keep fixing — "hardcoded tag where the option should
  // be read" — only fires when the option value differs from the default, so
  // fast-check randomizes the value on every run.
  test.prop([tagArb, typeArb])(
    "container without the configured `tag` calling an external of the configured `externalType` always fires",
    (customTag, customExternalType) => {
      const ext = makeContainer({ name: "ext", type: customExternalType });
      const svc = makeContainer({ name: "svc", relations: [{ to: ext }] });
      const violations = checkAcl([svc, ext], {
        tag: customTag,
        externalType: customExternalType,
      });
      expect(violations).toHaveLength(1);
      expect(violations[0].container).toBe("svc");
    },
  );

  test.prop([tagArb, typeArb])(
    "container WITH the configured `tag` calling an external of the configured `externalType` never fires",
    (customTag, customExternalType) => {
      const ext = makeContainer({ name: "ext", type: customExternalType });
      const svc = makeContainer({
        name: "svc",
        tags: [customTag],
        relations: [{ to: ext }],
      });
      expect(
        checkAcl([svc, ext], {
          tag: customTag,
          externalType: customExternalType,
        }),
      ).toHaveLength(0);
    },
  );
});

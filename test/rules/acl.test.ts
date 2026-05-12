import { fc, test } from "@fast-check/vitest";

import { aclRule } from "../../src/rules";
import { makeModel } from "../helpers/makeModel";

const tagArb = fc
  .string({ minLength: 2, maxLength: 8 })
  .filter((s) => /^[a-z][a-z0-9_]*$/.test(s));

describe("aclRule.check", () => {
  it("returns no violations when acl-tagged container depends on external", () => {
    const model = makeModel({
      containers: [
        { name: "my_acl", tags: ["acl"], relations: [{ to: "ext_system" }] },
        { name: "ext_system", kind: "System", external: true },
      ],
    });
    expect(aclRule.check(model)).toHaveLength(0);
  });

  it("returns violation when non-acl container depends on external", () => {
    const model = makeModel({
      containers: [
        { name: "my_service", relations: [{ to: "ext_system" }] },
        { name: "ext_system", kind: "System", external: true },
      ],
    });
    const v = aclRule.check(model);
    expect(v).toHaveLength(1);
    expect(v[0].container).toBe("my_service");
    expect(v[0].message).toContain("ext_system");
  });

  it("returns no violations when no external dependencies", () => {
    const model = makeModel({
      containers: [{ name: "a", relations: [{ to: "b" }] }, { name: "b" }],
    });
    expect(aclRule.check(model)).toHaveLength(0);
  });

  it("includes all external systems in violation message", () => {
    const model = makeModel({
      containers: [
        { name: "svc", relations: [{ to: "ext1" }, { to: "ext2" }] },
        { name: "ext1", kind: "System", external: true },
        { name: "ext2", kind: "System", external: true },
      ],
    });
    const v = aclRule.check(model);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain("ext1");
    expect(v[0].message).toContain("ext2");
    expect(v[0].message).toMatch(/systems/);
  });

  it("respects custom tag option", () => {
    const model = makeModel({
      containers: [
        {
          name: "anti_corruption",
          tags: ["custom-acl"],
          relations: [{ to: "ext" }],
        },
        { name: "ext", kind: "System", external: true },
      ],
    });
    expect(aclRule.check(model, { tag: "custom-acl" })).toHaveLength(0);
  });

  test.prop([tagArb])(
    "property: container with 'acl' tag never fires violation",
    () => {
      const model = makeModel({
        containers: [
          { name: "svc", tags: ["acl"], relations: [{ to: "e" }] },
          { name: "e", kind: "System", external: true },
        ],
      });
      expect(aclRule.check(model)).toHaveLength(0);
    },
  );
});

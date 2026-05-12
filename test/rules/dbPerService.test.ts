import { dbPerServiceRule } from "../../src/rules";
import { makeModel } from "../helpers/makeModel";

describe("dbPerServiceRule.check", () => {
  it("no violation when each DB has single accessor", () => {
    const model = makeModel({
      containers: [
        { name: "a", relations: [{ to: "db_a" }] },
        { name: "db_a", kind: "ContainerDb" },
      ],
    });
    expect(dbPerServiceRule.check(model)).toHaveLength(0);
  });

  it("violation when DB shared between multiple containers", () => {
    const model = makeModel({
      containers: [
        { name: "a", relations: [{ to: "shared_db" }] },
        { name: "b", relations: [{ to: "shared_db" }] },
        { name: "shared_db", kind: "ContainerDb" },
      ],
    });
    const v = dbPerServiceRule.check(model);
    expect(v).toHaveLength(1);
    expect(v[0].container).toBe("shared_db");
    expect(v[0].message).toContain("a");
    expect(v[0].message).toContain("b");
  });

  it("non-DB shared is fine", () => {
    const model = makeModel({
      containers: [
        { name: "a", relations: [{ to: "common" }] },
        { name: "b", relations: [{ to: "common" }] },
        { name: "common" },
      ],
    });
    expect(dbPerServiceRule.check(model)).toHaveLength(0);
  });
});

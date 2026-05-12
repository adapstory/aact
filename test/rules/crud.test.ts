import { crudRule } from "../../src/rules";
import { makeModel } from "../helpers/makeModel";

describe("crudRule.check", () => {
  it("no violation when only repo accesses DB", () => {
    const model = makeModel({
      containers: [
        {
          name: "orders_repo",
          tags: ["repo"],
          relations: [{ to: "orders_db" }],
        },
        { name: "orders_db", kind: "ContainerDb" },
      ],
    });
    expect(crudRule.check(model)).toHaveLength(0);
  });

  it("violation when non-repo accesses DB", () => {
    const model = makeModel({
      containers: [
        { name: "orders", relations: [{ to: "orders_db" }] },
        { name: "orders_db", kind: "ContainerDb" },
      ],
    });
    const v = crudRule.check(model);
    expect(v).toHaveLength(1);
    expect(v[0].container).toBe("orders");
    expect(v[0].message).toMatch(/repo/);
  });

  it("violation when repo has non-DB dependencies", () => {
    const model = makeModel({
      containers: [
        {
          name: "orders_repo",
          tags: ["repo"],
          relations: [{ to: "orders_db" }, { to: "other_service" }],
        },
        { name: "orders_db", kind: "ContainerDb" },
        { name: "other_service" },
      ],
    });
    const v = crudRule.check(model);
    expect(v).toHaveLength(1);
    expect(v[0].message).toMatch(/non-database/);
  });

  it("respects repoTags option", () => {
    const model = makeModel({
      containers: [
        { name: "orders_dao", tags: ["dao"], relations: [{ to: "orders_db" }] },
        { name: "orders_db", kind: "ContainerDb" },
      ],
    });
    expect(crudRule.check(model, { repoTags: ["dao"] })).toHaveLength(0);
  });
});

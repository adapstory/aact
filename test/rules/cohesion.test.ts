import { cohesionRule } from "../../src/rules";
import { makeModel } from "../helpers/makeModel";

describe("cohesionRule.check", () => {
  it("violation when coupling >= cohesion (no internal relations)", () => {
    const model = makeModel({
      containers: [
        { name: "a", relations: [{ to: "outside" }] },
        { name: "outside" },
      ],
      boundaries: [{ name: "b1", containerNames: ["a"] }],
    });
    const v = cohesionRule.check(model);
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].container).toBe("b1");
  });

  it("no violation when cohesion > coupling", () => {
    const model = makeModel({
      containers: [
        { name: "a", relations: [{ to: "b" }, { to: "c" }] },
        { name: "b", relations: [{ to: "c" }] },
        { name: "c" },
      ],
      boundaries: [{ name: "ctx", containerNames: ["a", "b", "c"] }],
    });
    expect(cohesionRule.check(model)).toHaveLength(0);
  });
});

import { stableDependenciesRule } from "../../src/rules";
import { makeModel } from "../helpers/makeModel";

describe("stableDependenciesRule.check", () => {
  it("no violation when deps point to more stable", () => {
    const model = makeModel({
      containers: [
        { name: "a", relations: [{ to: "b" }] },
        { name: "b", relations: [{ to: "c" }] },
        { name: "c" },
      ],
    });
    expect(stableDependenciesRule.check(model)).toHaveLength(0);
  });

  it("ignores external containers", () => {
    const model = makeModel({
      containers: [
        { name: "internal", relations: [{ to: "external" }] },
        { name: "external", kind: "System", external: true },
      ],
    });
    expect(stableDependenciesRule.check(model)).toHaveLength(0);
  });
});

import { commonReuseRule } from "../../src/rules";
import { makeModel } from "../helpers/makeModel";

describe("commonReuseRule.check", () => {
  it("violation when consumer uses subset of provider's public surface", () => {
    const model = makeModel({
      containers: [
        { name: "consumer", relations: [{ to: "p_a" }] },
        { name: "p_a" },
        { name: "p_b" },
        { name: "other", relations: [{ to: "p_b" }] },
      ],
      boundaries: [
        { name: "provider", containerNames: ["p_a", "p_b"] },
        { name: "cons_ctx", containerNames: ["consumer"] },
        { name: "other_ctx", containerNames: ["other"] },
      ],
    });
    const v = commonReuseRule.check(model);
    expect(v.length).toBeGreaterThan(0);
  });

  it("no violation when single-element public surface", () => {
    const model = makeModel({
      containers: [
        { name: "consumer", relations: [{ to: "p_a" }] },
        { name: "p_a" },
      ],
      boundaries: [
        { name: "provider", containerNames: ["p_a"] },
        { name: "cons_ctx", containerNames: ["consumer"] },
      ],
    });
    expect(commonReuseRule.check(model)).toHaveLength(0);
  });
});

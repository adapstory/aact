import { load } from "../../src/formats/plantuml/load";
import type { Model } from "../../src/model";
import { noDeprecatedTagRule } from "./rules/noDeprecatedTag";
import { repoNamingConventionRule } from "./rules/repoNamingConvention";

describe("custom-rules example", () => {
  let model: Model;

  beforeAll(async () => {
    const result = await load("examples/custom-rules/architecture.puml");
    model = result.model;
  });

  describe("noDeprecatedTag", () => {
    it("flags container tagged 'deprecated'", () => {
      const violations = noDeprecatedTagRule.check(model);
      expect(violations).toHaveLength(1);
      expect(violations[0].container).toBe("legacy_payments");
      expect(violations[0].message).toContain("deprecated");
    });

    it("respects custom tag option", () => {
      const violations = noDeprecatedTagRule.check(model, {
        tag: "nonexistent",
      });
      expect(violations).toHaveLength(0);
    });
  });

  describe("repoNamingConvention", () => {
    it("flags container tagged 'repo' that doesn't end with '_repo'", () => {
      const violations = repoNamingConventionRule.check(model);
      expect(violations).toHaveLength(1);
      expect(violations[0].container).toBe("orders_crud");
      expect(violations[0].message).toContain("_repo");
    });

    it("respects custom suffix option", () => {
      const violations = repoNamingConventionRule.check(model, {
        suffix: "_crud",
      });
      expect(violations).toHaveLength(0);
    });
  });

  it("both custom rules return well-formed Violation objects", () => {
    const all = [
      ...noDeprecatedTagRule.check(model),
      ...repoNamingConventionRule.check(model),
    ];
    for (const v of all) {
      expect(typeof v.container).toBe("string");
      expect(typeof v.message).toBe("string");
    }
  });
});

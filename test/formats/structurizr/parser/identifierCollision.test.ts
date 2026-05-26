import { parseSource } from "../../../../src/formats/structurizr/parser";

const parse = (src: string) => parseSource(src, "test.dsl");

describe("Structurizr parser — identifier re-registration", () => {
  it("emits a duplicate-identifier issue when the same id maps to two elements", () => {
    const src = `workspace {
      model {
        a = container "First"
        a = container "Second"
      }
    }`;
    const { issues } = parse(src);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "duplicate-identifier",
          identifier: "a",
        }),
      ]),
    );
  });

  it("does not flag the same identifier reused for the same element (idempotent)", () => {
    // Reopen with the same id is NOT a collision — the parser treats
    // `bank { ... }` as adding to the prior `bank` registration, and
    // identifierMap.get(lookupKey) returns the same value, so no issue.
    const src = `workspace {
      model {
        bank = softwareSystem "Bank"
        bank {
          description "Reopened"
        }
      }
    }`;
    const { issues } = parse(src);
    expect(issues.filter((i) => i.kind === "duplicate-identifier")).toEqual([]);
  });

  it("case-insensitive collision is detected (BANK vs bank)", () => {
    const src = `workspace {
      model {
        bank = softwareSystem "First"
        BANK = softwareSystem "Second"
      }
    }`;
    const { issues } = parse(src);
    expect(issues.some((i) => i.kind === "duplicate-identifier")).toBe(true);
  });
});

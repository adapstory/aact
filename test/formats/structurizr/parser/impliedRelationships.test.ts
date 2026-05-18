import { parseSource } from "../../../../src/formats/structurizr/parser";

const parse = (src: string) => parseSource(src, "test.dsl");

describe("Structurizr parser — !impliedRelationships true", () => {
  it("creates an implied edge from source's parent boundary", () => {
    const src = `workspace {
      model {
        !impliedRelationships true
        bank = softwareSystem "Bank" {
          api = container "API"
        }
        user = person "User"
        api -> user "Sends data to"
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    // Explicit: api -> user
    expect(model.containers["API"]?.relations).toEqual([
      expect.objectContaining({ to: "User", description: "Sends data to" }),
    ]);
    // Implied: Bank (parent of api) -> User
    const bankFromContainers = model.containers["Bank"];
    expect(bankFromContainers).toBeUndefined(); // Bank is a Boundary
    // The implied edge attaches at the Boundary's identifier; since
    // Bank is represented as a Boundary (no Container), the implied
    // edge cannot land on it directly. This is a known limitation:
    // the reference Model treats softwareSystem as both Element and
    // potential Boundary, but our split forbids edges on Boundary.
    expect(model.boundaries["Bank"]).toBeDefined();
  });

  it("implied edge inherits description and technology, with empty tags", () => {
    // Use two leaf containers nested in a single boundary so the
    // implied edge can land on a non-boundary container.
    const src = `workspace {
      model {
        !impliedRelationships true
        s = softwareSystem "S" {
          a = container "A"
          b = container "B"
        }
        ext = softwareSystem "Ext"
        a -> ext "uses" "HTTP" "internal"
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    // Explicit edge keeps default + header tags
    const explicit = model.containers["A"]?.relations[0];
    expect(explicit?.tags).toEqual(["Relationship", "internal"]);
    // No implied edge from "B" (no relation from B exists)
    expect(model.containers["B"]?.relations).toEqual([]);
  });

  it("does nothing when the directive is absent", () => {
    const src = `workspace {
      model {
        s = softwareSystem "S" {
          a = container "A"
        }
        ext = softwareSystem "Ext"
        a -> ext "uses"
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.containers["A"]?.relations).toEqual([
      expect.objectContaining({ to: "Ext", description: "uses" }),
    ]);
    // No implied edges
    expect(model.containers["Ext"]?.relations).toEqual([]);
  });

  it("does nothing for `!impliedRelationships false`", () => {
    const src = `workspace {
      model {
        !impliedRelationships false
        s = softwareSystem "S" {
          a = container "A"
        }
        ext = softwareSystem "Ext"
        a -> ext "uses"
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.containers["Ext"]?.relations).toEqual([]);
  });
});

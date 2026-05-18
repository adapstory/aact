import { parseSource } from "../../../../src/formats/structurizr/parser";

const parse = (src: string) => parseSource(src, "test.dsl");

describe("Structurizr parser — reference default tags", () => {
  it("person carries [Element, Person]", () => {
    const { model } = parse(`workspace { model { user = person "User" } }`);
    expect(model.containers["User"]?.tags).toEqual(["Element", "Person"]);
  });

  it("softwareSystem (leaf) carries [Element, Software System]", () => {
    const { model } = parse(`workspace { model { s = softwareSystem "S" } }`);
    expect(model.containers["S"]?.tags).toEqual(["Element", "Software System"]);
  });

  it("container carries [Element, Container]", () => {
    const { model } = parse(`workspace { model { c = container "C" } }`);
    expect(model.containers["C"]?.tags).toEqual(["Element", "Container"]);
  });

  it("component carries [Element, Component]", () => {
    const { model } = parse(`workspace { model { c = component "C" } }`);
    expect(model.containers["C"]?.tags).toEqual(["Element", "Component"]);
  });

  it("explicit tags append after defaults", () => {
    const src = `workspace {
      model {
        u = person "U" "" "vip,internal"
      }
    }`;
    const { model } = parse(src);
    expect(model.containers["U"]?.tags).toEqual([
      "Element",
      "Person",
      "vip",
      "internal",
    ]);
  });

  it("Boundary (softwareSystem with children) carries [Element, Software System]", () => {
    const src = `workspace {
      model {
        bank = softwareSystem "Bank" {
          api = container "API"
        }
      }
    }`;
    const { model } = parse(src);
    expect(model.boundaries["Bank"]?.tags).toEqual([
      "Element",
      "Software System",
    ]);
  });

  it("Boundary (container with components) carries [Element, Container]", () => {
    const src = `workspace {
      model {
        bank = softwareSystem "Bank" {
          api = container "API" {
            controller = component "Controller"
          }
        }
      }
    }`;
    const { model } = parse(src);
    expect(model.boundaries["API"]?.tags).toEqual(["Element", "Container"]);
  });

  it("Relation carries [Relationship] by default", () => {
    const src = `workspace {
      model {
        a = person "A"
        b = softwareSystem "B"
        a -> b
      }
    }`;
    const { model } = parse(src);
    expect(model.containers["A"]?.relations[0]?.tags).toEqual(["Relationship"]);
  });

  it("Relation header tags append after default", () => {
    const src = `workspace {
      model {
        a = person "A"
        b = softwareSystem "B"
        a -> b "uses" "HTTP" "internal,critical"
      }
    }`;
    const { model } = parse(src);
    expect(model.containers["A"]?.relations[0]?.tags).toEqual([
      "Relationship",
      "internal",
      "critical",
    ]);
  });
});

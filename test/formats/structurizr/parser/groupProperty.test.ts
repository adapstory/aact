import { parseSource } from "../../../../src/formats/structurizr/parser";

const parse = (src: string) => parseSource(src, "test.dsl");

describe("Structurizr parser — group → properties.group", () => {
  it("tags each container in a group with properties.group = <group name>", () => {
    const src = `workspace {
      model {
        group "Payments" {
          api = container "API"
          db = container "DB"
        }
        external = container "External"
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.containers["api"]?.properties?.group).toBe("Payments");
    expect(model.containers["db"]?.properties?.group).toBe("Payments");
    expect(model.containers["external"]?.properties?.group).toBeUndefined();
  });

  it("group does not itself appear in the Model as a Container or Boundary", () => {
    const src = `workspace {
      model {
        group "Payments" {
          api = container "API"
        }
      }
    }`;
    const { model } = parse(src);
    expect(model.containers["Payments"]).toBeUndefined();
    expect(model.boundaries["Payments"]).toBeUndefined();
  });

  it("nested groups join names with structurizr.groupSeparator", () => {
    // Reference: `GroupParser` reads `structurizr.groupSeparator` from
    // the model's `properties { }` block and joins nested group
    // names with it (`Outer/Inner` when separator is `/`).
    const src = `workspace {
      model {
        properties {
          "structurizr.groupSeparator" /
        }
        group "Outer" {
          group "Inner" {
            api = container "API"
          }
          db = container "DB"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.containers["api"]?.properties?.group).toBe("Outer/Inner");
    expect(model.containers["db"]?.properties?.group).toBe("Outer");
  });

  it("without separator, nested elements get the innermost group name only", () => {
    const src = `workspace {
      model {
        group "Outer" {
          group "Inner" {
            api = container "API"
          }
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.containers["api"]?.properties?.group).toBe("Inner");
  });

  it('`<element> { group "Layer" }` body-form sets properties.group', () => {
    // Reference: StructurizrDslParser.java:690-691 — a `group` token
    // inside a component body (no `{ }` block on the group) is a
    // property statement, not a nested element declaration.
    const src = `workspace {
      model {
        api = container "API" {
          ctrl = component "Controller" {
            group "Web Layer"
          }
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.containers["ctrl"]?.properties?.group).toBe("Web Layer");
  });

  it("preserves other properties alongside group", () => {
    const src = `workspace {
      model {
        group "Payments" {
          api = container "API" {
            properties {
              owner "platform-team"
            }
          }
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.containers["api"]?.properties).toEqual({
      owner: "platform-team",
      group: "Payments",
    });
  });
});

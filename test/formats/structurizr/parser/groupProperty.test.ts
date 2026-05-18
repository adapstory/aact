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
    expect(model.containers["API"]?.properties?.group).toBe("Payments");
    expect(model.containers["DB"]?.properties?.group).toBe("Payments");
    expect(model.containers["External"]?.properties?.group).toBeUndefined();
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
    expect(model.containers["API"]?.properties).toEqual({
      owner: "platform-team",
      group: "Payments",
    });
  });
});

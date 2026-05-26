import { parseSource } from "../../../../src/formats/structurizr/parser";

const parse = (src: string) => parseSource(src, "test.dsl");

describe("Structurizr parser — CustomElement (`element` keyword)", () => {
  it("parses `element <name>` and produces a Container with kind Container", () => {
    const src = `workspace {
      model {
        box = element "Box 1"
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["box"]).toBeDefined();
    expect(model.elements["box"]?.kind).toBe("Container");
  });

  it("carries only the `Element` tag (no kind-specific tag)", () => {
    // CustomElement is C4's escape hatch — `Element` is the abstract
    // parent type in C4 vocabulary, so we don't stamp a "second"
    // kind-specific tag the way Person/Container do. Rules looking
    // for `tags.includes("Person")` etc. naturally skip these.
    const src = `workspace {
      model {
        box = element "Box 1"
      }
    }`;
    const { model } = parse(src);
    expect(model.elements["box"]?.tags).toEqual(["Element"]);
  });

  it("accepts positional metadata, description, and tags", () => {
    const src = `workspace {
      model {
        box = element "Box" "MetaInfo" "A box outside C4" "external,visual"
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["box"]).toEqual(
      expect.objectContaining({
        description: "A box outside C4",
        tags: ["Element", "external", "visual"],
      }),
    );
  });
});

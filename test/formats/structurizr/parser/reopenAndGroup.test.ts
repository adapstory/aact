import { parseSource } from "../../../../src/formats/structurizr/parser";

const parse = (src: string) => parseSource(src, "test.dsl");

describe("Structurizr parser — re-open form", () => {
  it("merges body description onto an existing container", () => {
    const src = `workspace {
      model {
        api = container "API"
        api {
          description "Updated description"
          tag "core"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.containers["API"]).toEqual(
      expect.objectContaining({
        description: "Updated description",
        tags: ["Element", "Container", "core"],
      }),
    );
  });

  it("appends relationships using the reopen target as implicit source", () => {
    const src = `workspace {
      model {
        db = container "DB"
        api = container "API"
        api {
          -> db "writes"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.containers["API"]?.relations).toEqual([
      expect.objectContaining({ to: "DB", description: "writes" }),
    ]);
  });

  it("merges body onto a Boundary (softwareSystem with nested children)", () => {
    const src = `workspace {
      model {
        bank = softwareSystem "Bank" {
          api = container "API"
        }
        bank {
          description "Reopened bank description"
          tag "core"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.boundaries["Bank"]).toEqual(
      expect.objectContaining({
        description: "Reopened bank description",
        tags: ["Element", "Software System", "core"],
      }),
    );
  });

  it("merges tags onto existing tags (preserving order, deduping)", () => {
    const src = `workspace {
      model {
        api = container "API" "" "" "external"
        api {
          tag "core"
          tags "external,critical"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.containers["API"]?.tags).toEqual([
      "Element",
      "Container",
      "external",
      "core",
      "critical",
    ]);
  });

  it("silently drops a reopen pointing at an unknown identifier", () => {
    const src = `workspace {
      model {
        api = container "API"
        ghost {
          description "Should not crash"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.containers["API"]).toBeDefined();
  });

  it("hierarchical reopen target resolves via dotted identifier map", () => {
    const src = `workspace {
      model {
        bank = softwareSystem "Bank" {
          api = container "API"
        }
        bank.api {
          description "API inside bank"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.containers["API"]?.description).toBe("API inside bank");
  });
});

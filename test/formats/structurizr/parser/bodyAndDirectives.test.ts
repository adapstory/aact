import { parseSource } from "../../../../src/formats/structurizr/parser";

const parse = (src: string) => parseSource(src, "test.dsl");

describe("Structurizr parser — body statements + directives", () => {
  it("body `description` overrides header positional", () => {
    const src = `workspace {
      model {
        bank = softwareSystem "Bank" "Header description" {
          description "Body description"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.containers["Bank"]?.description).toBe("Body description");
  });

  it("body `technology` lands on Container.technology", () => {
    const src = `workspace {
      model {
        api = container "API" {
          technology "Node.js 22"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.containers["API"]?.technology).toBe("Node.js 22");
  });

  it("body `tags` appends to header tags (comma-split, de-duped)", () => {
    const src = `workspace {
      model {
        api = container "API" "" "" "external,api" {
          tags "compliance,api"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.containers["API"]?.tags).toEqual([
      "Element",
      "Container",
      "external",
      "api",
      "compliance",
    ]);
  });

  it("body `tags` accepts multiple whitespace-separated string args", () => {
    const src = `workspace {
      model {
        api = container "API" {
          tags "alpha" "beta" "gamma"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.containers["API"]?.tags).toEqual([
      "Element",
      "Container",
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("body `tag` appends a single tag", () => {
    const src = `workspace {
      model {
        api = container "API" {
          tag "compliance"
        }
      }
    }`;
    const { model } = parse(src);
    expect(model.containers["API"]?.tags).toEqual([
      "Element",
      "Container",
      "compliance",
    ]);
  });

  it("body `url` lands on Container.link", () => {
    const src = `workspace {
      model {
        api = container "API" {
          url "https://docs.example.com/api"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.containers["API"]?.link).toBe("https://docs.example.com/api");
  });

  it("body `properties { key value }` lands on Container.properties", () => {
    const src = `workspace {
      model {
        api = container "API" {
          properties {
            owner "platform-team"
            sla "99.99"
          }
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.containers["API"]?.properties).toEqual({
      owner: "platform-team",
      sla: "99.99",
    });
  });

  it("body `perspectives { name desc value }` populates properties.perspective.<name>", () => {
    const src = `workspace {
      model {
        api = container "API" {
          perspectives {
            Security "OWASP top 10 covered"
            Scalability "Tested to 10k rps" "high"
          }
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.containers["API"]?.properties).toEqual({
      "perspective.Security": "OWASP top 10 covered",
      "perspective.Security.value": "",
      "perspective.Scalability": "Tested to 10k rps",
      "perspective.Scalability.value": "high",
    });
  });

  it("parses !const and !var BEFORE the workspace block", () => {
    const src = `!const ORG "Acme"
!var VERSION "1.0"
workspace {
  model {
    api = container "API"
  }
}`;
    const { parseErrors, model } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.containers["API"]).toBeDefined();
  });

  it("parses workspace-scope !const before model { }", () => {
    const src = `workspace {
      !const ORG_TAG "platform"
      !var ENV "prod"
      model {
        api = container "API"
      }
    }`;
    const { parseErrors, model } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.containers["API"]).toBeDefined();
  });

  it("parses workspace-scope properties { } block", () => {
    const src = `workspace {
      properties {
        "structurizr.dsl.source" "false"
      }
      model {
        api = container "API"
      }
    }`;
    const { parseErrors, model } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.containers["API"]).toBeDefined();
  });

  it("supports !const with a triple-quoted text block value", () => {
    const src = `workspace {
      model {
        !const SVG """<svg>
          <path d="M0,0" />
        </svg>"""
        api = container "API"
      }
    }`;
    const { parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
  });

  it("supports !const at model scope (parsed, currently no toModel effect)", () => {
    const src = `workspace {
      model {
        !const MY_TAG "platform"
        api = container "API"
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.containers["API"]).toBeDefined();
  });

  it("supports !include at model scope", () => {
    const src = `workspace {
      model {
        !include "other.dsl"
        api = container "API"
      }
    }`;
    const { parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
  });

  it("supports !include with bare path (unquoted, with slashes)", () => {
    const src = `workspace {
      model {
        !include path/to/other.dsl
        api = container "API"
      }
    }`;
    const { parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
  });

  it("`workspace extends path/to/parent.dsl` parses without errors", () => {
    const src = `workspace extends path/to/parent.dsl {
      model {}
    }`;
    const { parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
  });

  it("supports !identifiers hierarchical", () => {
    const src = `workspace {
      model {
        !identifiers hierarchical
        api = container "API"
      }
    }`;
    const { parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
  });

  it("supports !impliedRelationships true", () => {
    const src = `workspace {
      model {
        !impliedRelationships true
        a = person "A"
        b = softwareSystem "B"
        a -> b
      }
    }`;
    const { parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
  });

  it("body statements on a promoted Boundary aggregate onto the Boundary", () => {
    const src = `workspace {
      model {
        bank = softwareSystem "Bank" {
          description "The bank's internal system"
          tag "core"
          api = container "API"
          db = container "DB"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.boundaries["Bank"]).toEqual(
      expect.objectContaining({
        description: "The bank's internal system",
        tags: ["Element", "Software System", "core"],
      }),
    );
    expect(model.containers["API"]).toBeDefined();
    expect(model.containers["DB"]).toBeDefined();
  });

  it("preserves sourceLocation on body-driven Container fields", () => {
    const src = `workspace {
      model {
        api = container "API" {
          technology "Node.js"
        }
      }
    }`;
    const { model } = parse(src);
    const c = model.containers["API"];
    expect(c?.sourceLocation?.file).toBe("test.dsl");
    expect(c?.technology).toBe("Node.js");
  });
});

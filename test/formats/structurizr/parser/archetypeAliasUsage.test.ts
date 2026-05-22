import { parseSource } from "../../../../src/formats/structurizr/parser";

const parse = (src: string) => parseSource(src, "test.dsl");

describe("Structurizr parser — archetype alias usage", () => {
  it("substitutes a simple kind alias with its base keyword", () => {
    // `datastore = container` — no body, just kind rename.
    const src = `workspace {
      model {
        archetypes {
          datastore = container
        }
        s = softwareSystem "S" {
          db = datastore "Customer database"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    // datastore → container, so `db` lands as an Element (Container),
    // not a parse error.
    expect(model.elements["db"]).toBeDefined();
    expect(model.elements["db"]?.label).toBe("Customer database");
  });

  it("applies archetype-body default tags to elements declared via alias", () => {
    const src = `workspace {
      model {
        archetypes {
          application = container {
            tag "Application"
          }
        }
        s = softwareSystem "S" {
          api = application "API"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]?.tags).toContain("Application");
  });

  it("supports chained aliases merging tags additively", () => {
    // springBootApplication aliases application (which aliases
    // container). Both alias bodies declare tags. Reference behaviour
    // (verified against `DslTests.test_archetypes`): the resulting
    // element carries BOTH tags but neither alias name itself.
    const src = `workspace {
      model {
        archetypes {
          application = container {
            tag "Application"
          }
          springBootApplication = application {
            technology "Spring Boot"
            tag "Spring Boot"
          }
        }
        s = softwareSystem "S" {
          api = springBootApplication "Customer API"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    const api = model.elements["api"];
    expect(api).toBeDefined();
    expect(api?.tags).toEqual(
      expect.arrayContaining(["Application", "Spring Boot"]),
    );
    expect(api?.tags).not.toContain("application");
    expect(api?.tags).not.toContain("springBootApplication");
    expect(api?.technology).toBe("Spring Boot");
  });

  it("source positionals win over archetype defaults", () => {
    const src = `workspace {
      model {
        archetypes {
          application = container {
            technology "Default Tech"
          }
        }
        s = softwareSystem "S" {
          api = application "API" "Explicit Desc" "Explicit Tech"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    const api = model.elements["api"];
    expect(api?.description).toBe("Explicit Desc");
    expect(api?.technology).toBe("Explicit Tech");
  });

  it("merges archetype tags with explicit header tags additively", () => {
    const src = `workspace {
      model {
        archetypes {
          application = container {
            tag "Application"
          }
        }
        s = softwareSystem "S" {
          api = application "API" "Desc" "Java" "Public, Critical"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    const api = model.elements["api"];
    expect(api?.tags).toEqual(
      expect.arrayContaining(["Application", "Public", "Critical"]),
    );
  });

  it("does not substitute alias outside element-kind position", () => {
    // `application` appears as a relationship endpoint here — must
    // remain a regular identifier reference, not get re-typed as a
    // base keyword.
    const src = `workspace {
      model {
        archetypes {
          application = container {
            tag "Application"
          }
        }
        s = softwareSystem "S" {
          api = application "API"
          db = container "DB"
          api -> db "writes"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]?.relations).toEqual([
      expect.objectContaining({ to: "db", description: "writes" }),
    ]);
  });

  it("case-insensitive alias resolution (reference dispatches via toLowerCase)", () => {
    const src = `workspace {
      model {
        archetypes {
          Application = container {
            tag "Application"
          }
        }
        s = softwareSystem "S" {
          api = APPLICATION "API"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]?.tags).toContain("Application");
  });

  it("reference fixture parity — archetypes.dsl style nesting", () => {
    // Adapted from `.parser-refs/.../archetypes.dsl`. Asserts the same
    // observable outcome the reference `DslTests.test_archetypes`
    // verifies (the Customer API container's tags + technology).
    const src = `workspace {
      model {
        archetypes {
          application = container {
            tag "Application"
          }
          datastore = container {
            tag "Datastore"
          }
          springBootApplication = application {
            technology "Spring Boot"
            tag "Spring Boot"
          }
          restController = component {
            technology "Spring MVC REST Controller"
            tag "Spring MVC REST Controller"
          }
        }
        a = softwareSystem "A"
        x = softwareSystem "X" {
          db = datastore "Customer database"
          api = springBootApplication "Customer API" {
            customerController = restController "Customer Controller"
          }
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    // `api` has nested `customerController` so it lands as a Boundary
    // (Container kind with children) rather than a leaf Element.
    // Archetype defaults still apply — tags + technology stay on the
    // resulting Boundary node.
    const apiBoundary = model.boundaries["api"];
    expect(apiBoundary).toBeDefined();
    expect(apiBoundary?.tags).toEqual(
      expect.arrayContaining(["Application", "Spring Boot"]),
    );
    const db = model.elements["db"];
    expect(db?.tags).toContain("Datastore");
    const controller = model.elements["customerController"];
    expect(controller?.tags).toContain("Spring MVC REST Controller");
    expect(controller?.technology).toBe("Spring MVC REST Controller");
  });

  it("exposes alias map on ChevrotainParseResult.archetypeAliases", () => {
    const src = `workspace {
      model {
        archetypes {
          application = container {
            tag "Application"
          }
          microservice = group
        }
        s = softwareSystem "S"
      }
    }`;
    const result = parse(src);
    expect(result.archetypeAliases.has("application")).toBe(true);
    expect(result.archetypeAliases.has("microservice")).toBe(true);
    const appAlias = result.archetypeAliases.get("application");
    expect(appAlias?.defaults.tags).toContain("Application");
  });
});

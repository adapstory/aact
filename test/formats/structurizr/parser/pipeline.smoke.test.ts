import { parseSource } from "../../../../src/formats/structurizr/parser";

describe("Structurizr parser pipeline (CST → AST → Model)", () => {
  it("produces an empty Model from an empty workspace+model", () => {
    const { model, parseErrors } = parseSource(
      `workspace { model {} }`,
      "in-memory.dsl",
    );
    expect(parseErrors).toEqual([]);
    expect(Object.keys(model.containers)).toEqual([]);
    expect(Object.keys(model.boundaries)).toEqual([]);
  });

  it("emits a Container for `person` and `softwareSystem` (no nested children)", () => {
    const src = `workspace {
      model {
        customer = person "Customer"
        mainframe = softwareSystem "Mainframe Banking"
      }
    }`;
    const { model, parseErrors } = parseSource(src, "test.dsl");
    expect(parseErrors).toEqual([]);
    expect(model.containers["Customer"]?.kind).toBe("Person");
    expect(model.containers["Mainframe Banking"]?.kind).toBe("System");
  });

  it("promotes softwareSystem with nested containers to a System boundary", () => {
    const src = `workspace {
      model {
        bank = softwareSystem "Internet Banking" {
          web = container "Web App" "Web UI" "Java"
          api = container "API" "API Application" "Node.js"
        }
      }
    }`;
    const { model, parseErrors } = parseSource(src, "test.dsl");
    expect(parseErrors).toEqual([]);
    // Bank promoted to Boundary; its children are Containers.
    expect(model.boundaries["Internet Banking"]?.kind).toBe("System");
    expect(model.boundaries["Internet Banking"]?.containerNames).toEqual([
      "Web App",
      "API",
    ]);
    expect(model.containers["Web App"]?.technology).toBe("Java");
    expect(model.containers["API"]?.technology).toBe("Node.js");
  });

  it("resolves relationships using `id = element` assignments", () => {
    const src = `workspace {
      model {
        customer = person "Customer"
        bank = softwareSystem "Internet Banking"
        customer -> bank "Uses"
      }
    }`;
    const { model, parseErrors } = parseSource(src, "test.dsl");
    expect(parseErrors).toEqual([]);
    expect(model.containers["Customer"]?.relations).toEqual([
      expect.objectContaining({
        to: "Internet Banking",
        description: "Uses",
      }),
    ]);
  });

  it("populates Container.sourceLocation with chevrotain positions", () => {
    const src = `workspace {
      model {
        bank = softwareSystem "Bank"
      }
    }`;
    const { model, parseErrors } = parseSource(src, "fixture.dsl");
    expect(parseErrors).toEqual([]);
    const loc = model.containers["Bank"]?.sourceLocation;
    expect(loc).toBeDefined();
    expect(loc?.file).toBe("fixture.dsl");
    // The `bank = softwareSystem "Bank"` line starts on line 3 of the
    // multi-line source (positions are 1-based).
    expect(loc?.start.line).toBe(3);
    expect(loc?.start.col).toBeGreaterThan(0);
    expect(loc?.end.line).toBe(3);
    expect(loc?.start.offset).toBeGreaterThanOrEqual(0);
  });

  it("populates Relation.sourceLocation with chevrotain positions", () => {
    const src = `workspace {\n  model {\n    a = person "A"\n    b = person "B"\n    a -> b "uses"\n  }\n}`;
    const { model, parseErrors } = parseSource(src, "rel.dsl");
    expect(parseErrors).toEqual([]);
    const rel = model.containers["A"]?.relations[0];
    expect(rel).toBeDefined();
    expect(rel?.sourceLocation?.file).toBe("rel.dsl");
    expect(rel?.sourceLocation?.start.line).toBe(5);
  });

  it("real-world fixture — Internet Banking model section", () => {
    const src = `workspace "Big Bank plc" "Internet Banking System" {
      model {
        customer = person "Personal Banking Customer"
        bank = softwareSystem "Internet Banking System" {
          webApplication = container "Web Application" "" "Java, Spring MVC"
          singlePageApplication = container "Single-Page Application" "" "JavaScript, Angular"
          mobileApp = container "Mobile App" "" "Xamarin"
          apiApplication = container "API Application" "" "Java, Spring MVC"
          database = container "Database" "" "Oracle Database Schema"
        }
        mainframe = softwareSystem "Mainframe Banking System"
        email = softwareSystem "E-mail System"

        customer -> webApplication "Visits bigbank.com/ib using" "HTTPS"
        customer -> singlePageApplication "Views account balances and makes payments using"
        apiApplication -> database "Reads from and writes to" "JDBC"
        apiApplication -> mainframe "Makes API calls to" "XML/HTTPS"
        apiApplication -> email "Sends e-mail using"
      }
    }`;
    const { model, parseErrors } = parseSource(src, "bank.dsl");
    expect(parseErrors).toEqual([]);
    // 1 Person + 5 nested Containers + 2 leaf Systems = 8 containers
    expect(Object.keys(model.containers).length).toBe(8);
    // 1 Boundary (the bank with nested containers)
    expect(Object.keys(model.boundaries).length).toBe(1);
    // 5 relations attached to source containers
    const totalRelations = Object.values(model.containers).reduce(
      (sum, c) => sum + c.relations.length,
      0,
    );
    expect(totalRelations).toBe(5);
  });

  it("resolves hierarchical refs `boundary.local` to nested elements", () => {
    const src = `workspace {
      model {
        bank = softwareSystem "Bank" {
          api = container "API"
          db = container "Database"
        }
        client = person "Client"
        client -> bank.api "calls"
        bank.api -> bank.db "reads"
      }
    }`;
    const { model, parseErrors } = parseSource(src, "hier.dsl");
    expect(parseErrors).toEqual([]);
    expect(model.containers["Client"]?.relations).toEqual([
      expect.objectContaining({ to: "API", description: "calls" }),
    ]);
    expect(model.containers["API"]?.relations).toEqual([
      expect.objectContaining({ to: "Database", description: "reads" }),
    ]);
  });

  it("returns parseErrors (does not throw) on malformed input", () => {
    const { parseErrors } = parseSource(
      `workspace { model { unclosed`,
      "broken.dsl",
    );
    expect(parseErrors.length).toBeGreaterThan(0);
  });
});

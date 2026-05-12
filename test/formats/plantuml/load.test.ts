import {
  loadPlantumlElements,
  mapContainersFromPlantumlElements,
} from "../../src/loaders/plantuml";
import { plantumlSyntax } from "../../src/loaders/plantuml/syntax";
import { ArchitectureModel } from "../../src/model";

describe("PlantUML Loader", () => {
  let model: ArchitectureModel;

  beforeAll(async () => {
    const pumlElements = await loadPlantumlElements(
      "resources/architecture/boundaries.puml",
    );
    model = mapContainersFromPlantumlElements(pumlElements);
  });

  it("loads containers", () => {
    expect(model.allContainers.length).toBeGreaterThan(0);
  });

  it("loads boundaries", () => {
    expect(model.boundaries.length).toBeGreaterThan(0);
  });

  it("builds relations between containers", () => {
    const relationsCount = model.allContainers.reduce(
      (sum, c) => sum + c.relations.length,
      0,
    );
    expect(relationsCount).toBeGreaterThan(0);
  });

  it("assigns boundary containers correctly", () => {
    for (const boundary of model.boundaries) {
      expect(
        boundary.containers.length + boundary.boundaries.length,
      ).toBeGreaterThan(0);
    }
  });

  it("rejects with ENOENT for nonexistent file", async () => {
    await expect(loadPlantumlElements("nonexistent.puml")).rejects.toThrow(
      /ENOENT/,
    );
  });
});

describe("loadPlantumlElements (unit)", () => {
  let tmpDir: string;
  beforeAll(async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    tmpDir = await mkdtemp(path.join(tmpdir(), "aact-puml-"));
  });

  const writeFixture = async (
    name: string,
    content: string,
  ): Promise<string> => {
    const { writeFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const file = path.join(tmpDir, name);
    await writeFile(file, content, "utf8");
    return file;
  };

  it("strips the $tags= prefix from the preprocessed source (regex pin)", async () => {
    const file = await writeFixture(
      "tags.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(svc, "Svc", "", "", $tags="acl")',
        "@enduml",
      ].join("\n"),
    );
    const elements = await loadPlantumlElements(file);
    const model = mapContainersFromPlantumlElements(elements);
    // The preprocessor turns `$tags="acl"` into `"acl"`, which the C4
    // macro reads as a sprite — surfaced on Container.tags as ["acl"].
    expect(model.allContainers[0].tags).toEqual(["acl"]);
  });

  it("swaps from/to for Rel_Back relations", async () => {
    const file = await writeFixture(
      "rel-back.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(a, "A")',
        'Container(b, "B")',
        // Rel_Back(a, b) means logically "b -> a" — the loader must swap.
        'Rel_Back(a, b, "test")',
        "@enduml",
      ].join("\n"),
    );
    const elements = await loadPlantumlElements(file);
    const model = mapContainersFromPlantumlElements(elements);
    const b = model.allContainers.find((c) => c.name === "b");
    expect(b?.relations[0].to.name).toBe("a");
  });

  it("leaves non-Rel_Back relations untouched", async () => {
    const file = await writeFixture(
      "rel.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(a, "A")',
        'Container(b, "B")',
        'Rel(a, b, "test")',
        "@enduml",
      ].join("\n"),
    );
    const elements = await loadPlantumlElements(file);
    const model = mapContainersFromPlantumlElements(elements);
    const a = model.allContainers.find((c) => c.name === "a");
    expect(a?.relations[0].to.name).toBe("b");
  });
});

describe("loadPlantumlElements + map: end-to-end fixture coverage", () => {
  let tmpDir: string;
  beforeAll(async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    tmpDir = await mkdtemp(path.join(tmpdir(), "aact-puml-e2e-"));
  });

  const writeFixture = async (
    name: string,
    content: string,
  ): Promise<string> => {
    const { writeFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const file = path.join(tmpDir, name);
    await writeFile(file, content, "utf8");
    return file;
  };

  const loadModel = async (
    name: string,
    content: string,
  ): Promise<ArchitectureModel> => {
    const file = await writeFixture(name, content);
    const elements = await loadPlantumlElements(file);
    return mapContainersFromPlantumlElements(elements);
  };

  it("recognises ContainerDb type from PUML", async () => {
    const model = await loadModel(
      "db.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'ContainerDb(orders_db, "Orders DB")',
        "@enduml",
      ].join("\n"),
    );
    expect(model.allContainers[0].type).toBe("ContainerDb");
  });

  it("recognises System_Ext type from PUML", async () => {
    const model = await loadModel(
      "ext.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'System_Ext(ext, "External System")',
        "@enduml",
      ].join("\n"),
    );
    expect(model.allContainers[0].type).toBe("System_Ext");
  });

  it("recognises Component type from PUML", async () => {
    const model = await loadModel(
      "comp.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Component(parser, "Parser")',
        "@enduml",
      ].join("\n"),
    );
    expect(model.allContainers[0].type).toBe("Component");
  });

  it("parses relation tags from the 5th arg (descr, comma-separated, trimmed)", async () => {
    const model = await loadModel(
      "tags.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(a, "A")',
        'Container(b, "B")',
        // Rel(from, to, label, technology, descr) — descr is parsed as tags.
        'Rel(a, b, "label", "REST", "async, audit")',
        "@enduml",
      ].join("\n"),
    );
    const a = model.allContainers.find((c) => c.name === "a")!;
    expect(a.relations[0].tags).toEqual(["async", "audit"]);
  });

  it("parses relation technology from the 4th arg", async () => {
    const model = await loadModel(
      "tech.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(a, "A")',
        'Container(b, "B")',
        'Rel(a, b, "label", "REST")',
        "@enduml",
      ].join("\n"),
    );
    const a = model.allContainers.find((c) => c.name === "a")!;
    expect(a.relations[0].technology).toBe("REST");
  });

  it("each new container starts with an empty relations array", async () => {
    const model = await loadModel(
      "empty-rel.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(a, "A")',
        "@enduml",
      ].join("\n"),
    );
    expect(model.allContainers[0].relations).toEqual([]);
  });

  it("sorts allContainers alphabetically by name", async () => {
    const model = await loadModel(
      "sort.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(z_svc, "Z")',
        'Container(a_svc, "A")',
        'Container(m_svc, "M")',
        "@enduml",
      ].join("\n"),
    );
    expect(model.allContainers.map((c) => c.name)).toEqual([
      "a_svc",
      "m_svc",
      "z_svc",
    ]);
  });

  it("includes only declared containers in a boundary, not unrelated ones", async () => {
    const model = await loadModel(
      "boundary.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(outside, "Outside")',
        'System_Boundary(orders, "Orders") {',
        '  Container(orders_api, "Orders API")',
        "}",
        "@enduml",
      ].join("\n"),
    );
    const orders = model.boundaries.find((b) => b.name === "orders")!;
    expect(orders.containers.map((c) => c.name)).toEqual(["orders_api"]);
    expect(orders.containers.some((c) => c.name === "outside")).toBe(false);
  });

  it("nests boundaries — child boundaries are registered as children of parent", async () => {
    const model = await loadModel(
      "nested.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'System_Boundary(platform, "Platform") {',
        '  System_Boundary(orders, "Orders") {',
        '    Container(api, "API")',
        "  }",
        "}",
        "@enduml",
      ].join("\n"),
    );
    const platform = model.boundaries.find((b) => b.name === "platform")!;
    expect(platform.boundaries.map((b) => b.name)).toContain("orders");
  });

  it("Stdlib_C4_Container_Component instances feed only the container pass, not the relation pass", async () => {
    // Pin L48 `if (element instanceof Stdlib_C4_Container_Component) continue;`.
    // With the mutation `false`, containers would be processed in the
    // relation loop too — could push spurious self-relations. Assert
    // each container has empty relations when no Rel() is declared.
    const model = await loadModel(
      "isolated.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(a, "A")',
        'Container(b, "B")',
        "@enduml",
      ].join("\n"),
    );
    for (const c of model.allContainers) {
      expect(c.relations).toEqual([]);
    }
  });

  it("renders System type from PUML", async () => {
    const model = await loadModel(
      "system.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'System(core, "Core System")',
        "@enduml",
      ].join("\n"),
    );
    expect(model.allContainers.find((c) => c.name === "core")?.type).toBe(
      "System",
    );
  });

  it("renders Person type from PUML", async () => {
    const model = await loadModel(
      "person.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Person(user, "End User")',
        "@enduml",
      ].join("\n"),
    );
    expect(model.allContainers.find((c) => c.name === "user")?.type).toBe(
      "Person",
    );
  });

  it("silently skips Rel() that references unknown containers (covers !containerFrom/!containerTo)", async () => {
    // mapContainersFromPlantumlElements L16, L18: `if (!containerFrom) return;`
    // and `if (!containerTo) return;`. Without those, push throws on
    // undefined. Pin: a Rel() with non-existent endpoints leaves the
    // model intact, no extra relations, no throw.
    const model = await loadModel(
      "missing.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(a, "A")',
        'Rel(ghost_from, ghost_to, "")',
        "@enduml",
      ].join("\n"),
    );
    expect(model.allContainers).toHaveLength(1);
    expect(model.allContainers[0].relations).toEqual([]);
  });
});

describe("mapContainersFromPlantumlElements (unit)", () => {
  it("skips relation to unknown container without throwing", async () => {
    // generated.puml has containers with known relations
    const elements = await loadPlantumlElements(
      "resources/architecture/generated.puml",
    );
    // If any relation targets a missing container, mapContainers should not throw
    expect(() => mapContainersFromPlantumlElements(elements)).not.toThrow();
  });
});

describe("plantumlSyntax helpers", () => {
  it("containerPattern returns a unique search anchor", () => {
    expect(plantumlSyntax.containerPattern("orders")).toBe("(orders,");
  });

  it("containerDecl without tags omits the $tags attribute", () => {
    expect(plantumlSyntax.containerDecl("orders", "Orders Service")).toBe(
      'Container(orders, "Orders Service")',
    );
  });

  it("containerDecl with tags emits $tags attribute", () => {
    expect(
      plantumlSyntax.containerDecl("orders_acl", "Orders ACL", "acl+repo"),
    ).toBe('Container(orders_acl, "Orders ACL", "", "", $tags="acl+repo")');
  });

  it("relationPattern matches a Rel( prefix for the given pair", () => {
    expect(plantumlSyntax.relationPattern("a", "b")).toBe("Rel(a, b");
  });

  it("relationDecl renders technology and tags when present", () => {
    expect(plantumlSyntax.relationDecl("a", "b", "REST", "async")).toBe(
      'Rel(a, b, "REST", $tags="async")',
    );
  });

  it("relationDecl tolerates missing technology", () => {
    expect(plantumlSyntax.relationDecl("a", "b")).toBe('Rel(a, b, "")');
  });
});

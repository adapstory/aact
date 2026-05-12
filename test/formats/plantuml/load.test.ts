import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import path from "pathe";

import { load } from "../../../src/formats/plantuml/load";
import { plantumlSyntax } from "../../../src/formats/plantuml/syntax";
import type { Model } from "../../../src/model";
import { allContainers, getContainer } from "../../../src/model";

describe("PlantUML load — fixture", () => {
  let model: Model;

  beforeAll(async () => {
    const result = await load("fixtures/architecture/boundaries.puml");
    model = result.model;
  });

  it("loads containers", () => {
    expect(allContainers(model).length).toBeGreaterThan(0);
  });

  it("loads boundaries", () => {
    expect(Object.values(model.boundaries).length).toBeGreaterThan(0);
  });

  it("builds relations between containers", () => {
    const relationsCount = allContainers(model).reduce(
      (sum, c) => sum + c.relations.length,
      0,
    );
    expect(relationsCount).toBeGreaterThan(0);
  });

  it("assigns boundary children correctly", () => {
    for (const boundary of Object.values(model.boundaries)) {
      expect(
        boundary.containerNames.length + boundary.boundaryNames.length,
      ).toBeGreaterThan(0);
    }
  });

  it("rejects with ENOENT for nonexistent file", async () => {
    await expect(load("nonexistent.puml")).rejects.toThrow(/ENOENT/);
  });
});

describe("PlantUML load — unit", () => {
  let tmpDir: string;
  beforeAll(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "aact-puml-"));
  });

  const writeFixture = async (
    name: string,
    content: string,
  ): Promise<string> => {
    const file = path.join(tmpDir, name);
    await writeFile(file, content, "utf8");
    return file;
  };

  const loadFromContent = async (
    name: string,
    content: string,
  ): Promise<Model> => {
    const file = await writeFixture(name, content);
    const result = await load(file);
    return result.model;
  };

  it("strips the $tags= prefix and surfaces as Container.tags", async () => {
    const model = await loadFromContent(
      "tags.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(svc, "Svc", "", "", $tags="acl")',
        "@enduml",
      ].join("\n"),
    );
    expect(getContainer(model, "svc")?.tags).toEqual(["acl"]);
  });

  it("swaps from/to for Rel_Back relations", async () => {
    const model = await loadFromContent(
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
    expect(getContainer(model, "b")?.relations[0].to).toBe("a");
  });

  it("leaves non-Rel_Back relations untouched", async () => {
    const model = await loadFromContent(
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
    expect(getContainer(model, "a")?.relations[0].to).toBe("b");
  });

  it("recognises ContainerDb kind from PUML", async () => {
    const model = await loadFromContent(
      "db.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'ContainerDb(orders_db, "Orders DB")',
        "@enduml",
      ].join("\n"),
    );
    expect(getContainer(model, "orders_db")?.kind).toBe("ContainerDb");
  });

  it("recognises System_Ext as kind=System + external=true", async () => {
    const model = await loadFromContent(
      "ext.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'System_Ext(ext, "External System")',
        "@enduml",
      ].join("\n"),
    );
    const ext = getContainer(model, "ext");
    expect(ext?.kind).toBe("System");
    expect(ext?.external).toBe(true);
  });

  it("recognises Component kind from PUML", async () => {
    const model = await loadFromContent(
      "comp.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Component(parser, "Parser")',
        "@enduml",
      ].join("\n"),
    );
    expect(getContainer(model, "parser")?.kind).toBe("Component");
  });

  it("renders System kind from PUML", async () => {
    const model = await loadFromContent(
      "system.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'System(core, "Core System")',
        "@enduml",
      ].join("\n"),
    );
    expect(getContainer(model, "core")?.kind).toBe("System");
  });

  it("renders Person kind from PUML", async () => {
    const model = await loadFromContent(
      "person.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Person(user, "End User")',
        "@enduml",
      ].join("\n"),
    );
    expect(getContainer(model, "user")?.kind).toBe("Person");
  });

  it("parses relation tags from the descr/5th arg", async () => {
    const model = await loadFromContent(
      "rel-tags.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(a, "A")',
        'Container(b, "B")',
        'Rel(a, b, "label", "REST", "async, audit")',
        "@enduml",
      ].join("\n"),
    );
    expect(getContainer(model, "a")?.relations[0].tags).toEqual([
      "async",
      "audit",
    ]);
  });

  it("parses relation technology from the 4th arg", async () => {
    const model = await loadFromContent(
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
    expect(getContainer(model, "a")?.relations[0].technology).toBe("REST");
  });

  it("each new container starts with an empty relations array", async () => {
    const model = await loadFromContent(
      "empty-rel.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(a, "A")',
        "@enduml",
      ].join("\n"),
    );
    expect(getContainer(model, "a")?.relations).toEqual([]);
  });

  it("model.containers Record is sorted alphabetically (buildModel guarantee)", async () => {
    const model = await loadFromContent(
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
    expect(Object.keys(model.containers)).toEqual(["a_svc", "m_svc", "z_svc"]);
  });

  it("includes only declared containers in a boundary, not unrelated ones", async () => {
    const model = await loadFromContent(
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
    const orders = model.boundaries.orders;
    expect(orders.containerNames).toEqual(["orders_api"]);
    expect(orders.containerNames).not.toContain("outside");
  });

  it("nests boundaries — child boundary names land under parent.boundaryNames", async () => {
    const model = await loadFromContent(
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
    expect(model.boundaries.platform?.boundaryNames).toContain("orders");
  });

  it("does NOT push spurious self-relations for isolated containers (no Rel)", async () => {
    const model = await loadFromContent(
      "isolated.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(a, "A")',
        'Container(b, "B")',
        "@enduml",
      ].join("\n"),
    );
    for (const c of allContainers(model)) {
      expect(c.relations).toEqual([]);
    }
  });

  it("dangling Rel() with unknown source/target surfaces via issues (no throw)", async () => {
    const file = await writeFixture(
      "missing.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(a, "A")',
        'Rel(a, ghost_to, "")',
        "@enduml",
      ].join("\n"),
    );
    const result = await load(file);
    expect(allContainers(result.model)).toHaveLength(1);
    // The dangling target name appears in validation issues — loader survives.
    const dangling = result.issues.find((i) => i.kind === "dangling-relation");
    expect(dangling).toBeDefined();
  });
});

describe("PlantUML load — fixture-coverage edge", () => {
  it("loading generated.puml fixture doesn't throw", async () => {
    await expect(
      load("fixtures/architecture/generated.puml"),
    ).resolves.toBeDefined();
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

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

  it.each([
    ["ContainerQueue", "ContainerQueue"],
    ["Container_Ext", "Container"],
    ["ContainerDb_Ext", "ContainerDb"],
    ["ContainerQueue_Ext", "ContainerQueue"],
    ["ComponentDb", "ComponentDb"],
    ["ComponentQueue", "ComponentQueue"],
    ["Component_Ext", "Component"],
    ["ComponentDb_Ext", "ComponentDb"],
    ["ComponentQueue_Ext", "ComponentQueue"],
    ["Person_Ext", "Person"],
    ["SystemDb", "System"],
    ["SystemQueue", "System"],
    ["SystemDb_Ext", "System"],
    ["SystemQueue_Ext", "System"],
  ])(
    "filterElements recognises %s macro → kind=%s",
    async (macro, expectedKind) => {
      // Covers every entry in filterElements' CONTAINER_LIKE_NAMES /
      // CONTEXT_NAMES sets. Without these tests, Stryker can mutate any
      // string literal in those sets to "" and PUML containing that macro
      // would still load (silently dropped) — bug masquerading as design.
      const model = await loadFromContent(
        `${macro.toLowerCase()}.puml`,
        [
          "@startuml",
          "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
          `${macro}(elem, "Label")`,
          "@enduml",
        ].join("\n"),
      );
      expect(getContainer(model, "elem")?.kind).toBe(expectedKind);
    },
  );

  it("Container without technology arg has technology=undefined", async () => {
    const model = await loadFromContent(
      "no-tech.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(svc, "Svc")',
        "@enduml",
      ].join("\n"),
    );
    expect(getContainer(model, "svc")?.technology).toBeUndefined();
  });

  it("Container with technology arg preserves it", async () => {
    const model = await loadFromContent(
      "tech-arg.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(svc, "Svc", "Spring Boot")',
        "@enduml",
      ].join("\n"),
    );
    expect(getContainer(model, "svc")?.technology).toBe("Spring Boot");
  });

  it("Person ignores technology slot (Context, no techn field)", async () => {
    // Pin: technology populated только когда `techn` IN el AND non-empty.
    // Person doesn't have techn → must stay undefined.
    const model = await loadFromContent(
      "person-no-tech.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Person(user, "User")',
        "@enduml",
      ].join("\n"),
    );
    expect(getContainer(model, "user")?.technology).toBeUndefined();
  });

  it("Container with explicit description fills the description field", async () => {
    const model = await loadFromContent(
      "with-desc.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(svc, "Svc", "tech", "Detailed purpose")',
        "@enduml",
      ].join("\n"),
    );
    expect(getContainer(model, "svc")?.description).toBe("Detailed purpose");
  });

  it("Container without description has empty-string description (covers el.descr || '')", async () => {
    const model = await loadFromContent(
      "no-desc.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(svc, "Svc")',
        "@enduml",
      ].join("\n"),
    );
    expect(getContainer(model, "svc")?.description).toBe("");
  });

  it("Rel preserves description from label arg", async () => {
    const model = await loadFromContent(
      "rel-desc.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(a, "A")',
        'Container(b, "B")',
        'Rel(a, b, "calls")',
        "@enduml",
      ].join("\n"),
    );
    expect(getContainer(model, "a")?.relations[0].description).toBe("calls");
  });

  it("Rel without technology has technology=undefined (covers rel.techn || undefined)", async () => {
    const model = await loadFromContent(
      "rel-no-tech.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(a, "A")',
        'Container(b, "B")',
        'Rel(a, b, "")',
        "@enduml",
      ].join("\n"),
    );
    expect(getContainer(model, "a")?.relations[0].technology).toBeUndefined();
  });

  it("Rel without label has description=undefined", async () => {
    const model = await loadFromContent(
      "rel-empty-label.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(a, "A")',
        'Container(b, "B")',
        'Rel(a, b, "")',
        "@enduml",
      ].join("\n"),
    );
    expect(getContainer(model, "a")?.relations[0].description).toBeUndefined();
  });

  it("Rel preserves technology from techn arg", async () => {
    const model = await loadFromContent(
      "rel-with-tech.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(a, "A")',
        'Container(b, "B")',
        'Rel(a, b, "calls", "REST")',
        "@enduml",
      ].join("\n"),
    );
    expect(getContainer(model, "a")?.relations[0].technology).toBe("REST");
  });

  it("Rel without tags has tags=[] (covers parseCsvTags empty)", async () => {
    const model = await loadFromContent(
      "rel-no-tags.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(a, "A")',
        'Container(b, "B")',
        'Rel(a, b, "x")',
        "@enduml",
      ].join("\n"),
    );
    expect(getContainer(model, "a")?.relations[0].tags).toEqual([]);
  });

  it("Comment elements are ignored by normalizeRelBack (covers instanceof Comment continue)", async () => {
    // Comments before Rel_Back must not interfere with swap logic.
    const model = await loadFromContent(
      "comment-rel-back.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        "' top-level comment",
        'Container(a, "A")',
        'Container(b, "B")',
        "' another comment",
        'Rel_Back(a, b, "test")',
        "@enduml",
      ].join("\n"),
    );
    // Rel_Back(a,b) → swap → b → a
    expect(getContainer(model, "b")?.relations[0].to).toBe("a");
  });

  it("non-Rel_Back relation in normalizeRelBack scope stays untouched (instanceof Stdlib_C4_Dynamic_Rel guard)", async () => {
    const model = await loadFromContent(
      "rel-normal-untouched.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(a, "A")',
        'Container(b, "B")',
        'Rel(a, b, "x")',
        "@enduml",
      ].join("\n"),
    );
    expect(getContainer(model, "a")?.relations[0].to).toBe("b");
    expect(getContainer(model, "b")?.relations ?? []).toHaveLength(0);
  });

  it.each([
    ["System_Boundary", "System"],
    ["Container_Boundary", "Container"],
    ["Enterprise_Boundary", "Enterprise"],
    // Note: Component_Boundary в filterElements list, но plantuml-parser
    // 0.4 его не парсит — dead branch. Дропнуть из набора при следующем
    // upgrade плансера или явно ignore.
  ])(
    "filterElements recognises %s → boundary.kind=%s",
    async (macro, expectedKind) => {
      const model = await loadFromContent(
        `${macro.toLowerCase()}.puml`,
        [
          "@startuml",
          "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
          `${macro}(b1, "Boundary") {`,
          `  Container(c, "C")`,
          "}",
          "@enduml",
        ].join("\n"),
      );
      expect(model.boundaries.b1?.kind).toBe(expectedKind);
    },
  );

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

describe("PlantUML load — F2 fidelity (link, sprite, BiRel)", () => {
  let tmpDir: string;
  beforeAll(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "aact-puml-f2-"));
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

  it("preserves Container.link from $link= named arg", async () => {
    const model = await loadFromContent(
      "link.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(svc, "Svc", "Java", "Backend service", "img/svc.png", "core", "https://wiki.example.com/svc")',
        "@enduml",
      ].join("\n"),
    );
    expect(getContainer(model, "svc")?.link).toBe(
      "https://wiki.example.com/svc",
    );
  });

  it("preserves Container.sprite from positional 5th arg", async () => {
    const model = await loadFromContent(
      "sprite.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(svc, "Svc", "Java", "Backend", "java-logo")',
        "@enduml",
      ].join("\n"),
    );
    // sprite present, tags empty → sprite preserved (not fallback'нут как tags)
    expect(getContainer(model, "svc")?.sprite).toBe("java-logo");
    expect(getContainer(model, "svc")?.tags).toEqual([]);
  });

  it("BiRel expands to two directed Rel — a→b AND b→a", async () => {
    // C4-PlantUML stdlib: BiRel(a, b, label) семантически = Rel(a,b) + Rel(b,a).
    // Loader должен expand'ить, чтобы downstream rules видели обе стороны графа.
    const model = await loadFromContent(
      "birel.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(svc_a, "A")',
        'Container(svc_b, "B")',
        'BiRel(svc_a, svc_b, "talks to")',
        "@enduml",
      ].join("\n"),
    );
    const a = getContainer(model, "svc_a")!;
    const b = getContainer(model, "svc_b")!;
    expect(a.relations).toHaveLength(1);
    expect(a.relations[0].to).toBe("svc_b");
    expect(b.relations).toHaveLength(1);
    expect(b.relations[0].to).toBe("svc_a");
    // Both relations carry the same attributes (label, technology, tags).
    expect(a.relations[0].description).toBe("talks to");
    expect(b.relations[0].description).toBe("talks to");
  });

  it.each(["BiRel_U", "BiRel_D", "BiRel_L", "BiRel_R", "BiRel_Neighbor"])(
    "%s directional variant also expands to two relations",
    async (macro) => {
      const model = await loadFromContent(
        `${macro.toLowerCase()}.puml`,
        [
          "@startuml",
          "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
          'Container(svc_a, "A")',
          'Container(svc_b, "B")',
          `${macro}(svc_a, svc_b, "x")`,
          "@enduml",
        ].join("\n"),
      );
      expect(getContainer(model, "svc_a")?.relations[0].to).toBe("svc_b");
      expect(getContainer(model, "svc_b")?.relations[0].to).toBe("svc_a");
    },
  );

  it("Rel (non-BiRel) stays unidirectional", async () => {
    const model = await loadFromContent(
      "rel-unidir.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(a, "A")',
        'Container(b, "B")',
        'Rel(a, b, "x")',
        "@enduml",
      ].join("\n"),
    );
    expect(getContainer(model, "a")?.relations).toHaveLength(1);
    expect(getContainer(model, "b")?.relations).toHaveLength(0);
  });

  it("Relation.link preserved from $link= named arg", async () => {
    const model = await loadFromContent(
      "rel-link.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(a, "A")',
        'Container(b, "B")',
        'Rel(a, b, "calls", "REST", "details", "spr", "tag1", "https://api.docs/v1")',
        "@enduml",
      ].join("\n"),
    );
    expect(getContainer(model, "a")?.relations[0].link).toBe(
      "https://api.docs/v1",
    );
  });

  it("Boundary.link preserved from $link= positional", async () => {
    const model = await loadFromContent(
      "boundary-link.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'System_Boundary(orders, "Orders", "tag1", "https://wiki/orders") {',
        '  Container(api, "API")',
        "}",
        "@enduml",
      ].join("\n"),
    );
    expect(model.boundaries.orders?.link).toBe("https://wiki/orders");
  });
});

describe("PlantUML load — F2 known silent drops (plantuml-parser 0.4)", () => {
  let tmpDir: string;
  beforeAll(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "aact-puml-drops-"));
  });

  const loadFromContent = async (
    name: string,
    content: string,
  ): Promise<Model> => {
    const file = path.join(tmpDir, name);
    await writeFile(file, content, "utf8");
    return (await load(file)).model;
  };

  /*
   * Below — explicit pin'ы для known limitations. Если plantuml-parser
   * получит native support (или мы добавим regex-scan), тесты упадут и
   * это станет триггером для миграции. CHANGELOG должен документировать
   * любое изменение поведения тут.
   */

  it("KNOWN GAP: PUML SetPropertyHeader/AddProperty не парсятся — Container.properties undefined", async () => {
    const model = await loadFromContent(
      "props.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'SetPropertyHeader("Header", "Value")',
        'AddProperty("SLA", "99.9%")',
        'AddProperty("Owner", "team-x")',
        'Container(svc, "Svc")',
        "@enduml",
      ].join("\n"),
    );
    // Container loaded, но properties stay undefined (parser drops the
    // SetPropertyHeader/AddProperty side-effects). Документировано.
    expect(getContainer(model, "svc")).toBeDefined();
    expect(getContainer(model, "svc")?.properties).toBeUndefined();
  });

  it("KNOWN GAP: Boundary description не expose'ится parser'ом — Boundary.description undefined", async () => {
    // plantuml-parser 0.4 принимает только 4 positional для Boundary
    // (alias, label, tags, link). Spec C4-PlantUML stdlib допускает 6
    // positional с descr, но parser падает с PEG syntax error на 5-ом arg.
    // Этот gap пинает текущее поведение — Boundary всегда без description.
    const model = await loadFromContent(
      "boundary-no-descr.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'System_Boundary(orders, "Orders") {',
        '  Container(api, "API")',
        "}",
        "@enduml",
      ].join("\n"),
    );
    expect(model.boundaries.orders).toBeDefined();
    expect(model.boundaries.orders?.description).toBeUndefined();
  });

  it("KNOWN GAP: $index= для Dynamic diagrams — Relation.order undefined", async () => {
    const model = await loadFromContent(
      "indexed.puml",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(a, "A")',
        'Container(b, "B")',
        'Rel(a, b, "step 1", $index=1)',
        'Rel(b, a, "step 2", $index=2)',
        "@enduml",
      ].join("\n"),
    );
    // Both relations loaded but order field stays undefined — Dynamic diagrams
    // и step ordering — v3.x feature.
    const a = getContainer(model, "a")!;
    const b = getContainer(model, "b")!;
    expect(a.relations[0]?.order).toBeUndefined();
    expect(b.relations[0]?.order).toBeUndefined();
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

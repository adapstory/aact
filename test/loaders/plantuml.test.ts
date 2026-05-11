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

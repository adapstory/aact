import { loadStructurizrElements } from "../../src/loaders/structurizr";
import { ArchitectureModel } from "../../src/model";

describe("Structurizr Loader", () => {
  let model: ArchitectureModel;

  beforeAll(async () => {
    model = await loadStructurizrElements(
      "resources/architecture/workspace.json",
    );
  });

  it("loads containers from workspace.json", () => {
    expect(model.allContainers.length).toBeGreaterThan(0);
  });

  it("identifies external systems", () => {
    const externalSystems = model.allContainers.filter(
      (c) => c.type === "System_Ext",
    );
    expect(externalSystems.length).toBeGreaterThan(0);
  });

  it("identifies databases", () => {
    const databases = model.allContainers.filter(
      (c) => c.type === "ContainerDb",
    );
    expect(databases.length).toBeGreaterThan(0);
  });

  it("loads boundaries", () => {
    expect(model.boundaries.length).toBeGreaterThan(0);
  });

  it("builds relations", () => {
    const relationsCount = model.allContainers.reduce(
      (sum, c) => sum + c.relations.length,
      0,
    );
    expect(relationsCount).toBeGreaterThan(0);
  });

  it("rejects with ENOENT for nonexistent file", async () => {
    await expect(loadStructurizrElements("nonexistent.json")).rejects.toThrow(
      /ENOENT/,
    );
  });
});

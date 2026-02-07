import {
  loadPlantumlElements,
  mapContainersFromPlantumlElements,
} from "../../src/loaders/plantuml";
import { ArchitectureModel } from "../../src/model";

describe("PlantUML Loader", () => {
  let model: ArchitectureModel;

  beforeAll(async () => {
    const pumlElements = await loadPlantumlElements("boundaries.puml");
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
});

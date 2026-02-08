import { analyzeArchitecture } from "../src/analyzer";
import type { ArchitectureModel, Container } from "../src/model";

describe("analyzeArchitecture", () => {
  const db: Container = {
    name: "orders_db",
    label: "Orders DB",
    type: "ContainerDb",
    description: "",
    relations: [],
  };

  const extSystem: Container = {
    name: "ext_payment",
    label: "External Payment",
    type: "System_Ext",
    description: "",
    relations: [],
  };

  const svcB: Container = {
    name: "svc_b",
    label: "Service B",
    type: "Container",
    description: "",
    relations: [{ to: db }],
  };

  const svcA: Container = {
    name: "svc_a",
    label: "Service A",
    type: "Container",
    description: "",
    relations: [
      { to: svcB, technology: "http" },
      { to: extSystem, technology: "https://api.ext.com" },
      { to: svcB, tags: ["async"] },
    ],
  };

  const model: ArchitectureModel = {
    boundaries: [
      {
        name: "project",
        label: "Project",
        containers: [svcA, svcB, db, extSystem],
        boundaries: [],
      },
    ],
    allContainers: [svcA, svcB, db, extSystem],
  };

  it("counts elements", () => {
    const { report } = analyzeArchitecture(model);
    expect(report.elementsCount).toBe(4);
  });

  it("counts sync API calls", () => {
    const { report } = analyzeArchitecture(model);
    // svcA→svcB (http) and svcA→extSystem (System_Ext, non-async)
    expect(report.syncApiCalls).toBe(2);
  });

  it("counts async API calls", () => {
    const { report } = analyzeArchitecture(model);
    // svcA→svcB (async tag)
    expect(report.asyncApiCalls).toBe(1);
  });

  it("counts databases", () => {
    const { report } = analyzeArchitecture(model);
    expect(report.databases.count).toBe(1);
    expect(report.databases.consumes).toBe(1);
  });

  it("computes boundary metrics", () => {
    const { report } = analyzeArchitecture(model);
    expect(report.boundaries).toHaveLength(1);
    const b = report.boundaries[0];
    expect(b.name).toBe("project");
    expect(b.cohesion).toBeGreaterThan(0);
  });
});
